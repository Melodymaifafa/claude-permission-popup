import { basename } from "node:path";
import { labels } from "./i18n.mjs";

const HEAD = 240;        // chars of a command / path / URL shown before the cut
const SEGMENT_MAX = 160; // chars of the risky command segment
const VALUE_MAX = 80;    // chars per key=value value
const MAX_FIELDS = 3;    // key=value lines
const MAX_TOTAL = 1500;  // whole text: a huge payload must not make a giant dialog

// Commands that are why a Bash request gets asked about. In a long command the
// segment running one of them may sit far past the cut, so it gets its own line.
const RISKY = /^(?:(?:then|do|else)\s+|[({!]\s*)*(?:sudo|rm|rmdir|mv|dd|chmod|chown|kill|curl|wget|git\s+(?:push|reset|clean))\b/;

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// First segment of a shell command (split on && || ; | newline) that starts
// with a risky command, or "". Pure.
export function riskySegment(command) {
  for (const seg of command.split(/&&|\|\||[;|\n]/)) {
    const s = seg.trim();
    if (RISKY.test(s)) return s;
  }
  return "";
}

// First line: a plain sentence for the tools asked about most (an MCP tool is
// matched without its mcp__<server>__ prefix), else an unknown MCP tool split
// into server and tool, else the raw name. Pure.
function ask(toolName, L) {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  const name = mcp ? mcp[2] : toolName.replace(/^mcp__/, "");
  if (Object.hasOwn(L.knownTools, name)) return L.knownTools[name];
  return mcp ? L.allowMcp(mcp[1], mcp[2]) : L.allowTool(name);
}

// The command / file / URL behind the request, or the arguments of any other
// tool as key=value lines. Pure.
function detail(toolInput, L) {
  const main = toolInput.command ?? toolInput.file_path ?? toolInput.url;
  if (main != null) {
    const text = String(main);
    if (text.length <= HEAD) return text;
    const risky = toolInput.command != null ? riskySegment(text) : "";
    return (risky ? `⚠️ ${clip(risky, SEGMENT_MAX)}\n\n` : "") + text.slice(0, HEAD) + L.moreChars(text.length - HEAD);
  }
  const entries = Object.entries(toolInput);
  const lines = entries.slice(0, MAX_FIELDS).map(([k, v]) => {
    const value = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
    return `${k}=${clip(value.replace(/\s+/g, " "), VALUE_MAX)}`;
  });
  if (entries.length > MAX_FIELDS) lines.push(L.moreFields(entries.length - MAX_FIELDS));
  return lines.join("\n");
}

// The dialog text (without the update notice): what is asked, who asks — the
// scheduled task, else the session's folder — the details, and last the raw
// tool name, kept under the cap so it can still be looked up. Pure.
export function buildMessage({ toolName, toolInput, cwd, taskName, lang }) {
  const L = labels(lang);
  let message = toolName ? ask(toolName, L) : L.allowAction;
  const folder = cwd ? basename(cwd) : "";
  if (taskName) message += "\n" + L.fromTask(clip(taskName, VALUE_MAX));
  else if (folder) message += "\n" + L.fromFolder(clip(folder, VALUE_MAX));
  const body = detail(toolInput || {}, L);
  if (body) message += `\n\n${body}`;
  if (!toolName) return clip(message, MAX_TOTAL);
  const tool = "\n\n" + L.toolName(clip(toolName, HEAD));
  return clip(message, MAX_TOTAL - tool.length) + tool;
}
