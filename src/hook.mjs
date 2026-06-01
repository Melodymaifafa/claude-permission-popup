import { homedir } from "node:os";
import { join } from "node:path";
import { showDialog } from "./dialog.mjs";
import { pickLang, labels } from "./i18n.mjs";

const ALLOW = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
const DENY = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } });

// Tools the popup must stay OUT of: it abstains (exit 0, no stdout) so Claude
// Code runs its native flow for them. Two reasons a tool belongs here:
//   1. It renders its OWN interactive UI (a choice list, a plan-approval
//      prompt). Force-allowing such a tool resolves the permission as "granted"
//      but SWALLOWS that UI. Abstaining is the only output that lets it render.
//      The two built-in interactive tools: AskUserQuestion and ExitPlanMode.
//   2. No-side-effect bookkeeping (the Todo tools) — a popup is pure noise.
const IGNORE = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite", "TodoRead"]);

const TIMEOUT = 120; // dialog auto-dismisses after 2 min; under the settings.json hook timeout
const ICON = join(homedir(), ".claude/hooks/claude-permission-popup/claude-icon-rounded.png");

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(buf));
  });
}

async function main() {
  let input = {};
  try { input = JSON.parse((await readStdin()) || "{}"); } catch { input = {}; }
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};

  if (IGNORE.has(toolName)) return; // abstain → native flow handles these

  const L = labels(pickLang());

  let message = toolName ? L.allowTool(toolName) : L.allowAction;
  // Context line: the command / file / URL behind this request, capped so a
  // huge payload can't blow up the dialog.
  const detail = String(toolInput.command ?? toolInput.file_path ?? toolInput.url ?? "").slice(0, 240);
  if (detail) message += `\n\n${detail}`;

  // Three buttons: Back (cancel) / Deny / Allow. "Always / don't ask again" is
  // intentionally delegated to Claude Code's native prompt, which scopes it far
  // better (per program, per directory) than this popup could. Back is the
  // cancel button, so clicking it OR pressing Esc dismisses the popup → the
  // hook abstains → Claude Code's native 1/2/3 terminal prompt takes over,
  // where the richer "don't ask again" choice lives.
  const clicked = await showDialog({
    title: L.title, message, iconPath: ICON,
    buttons: [L.back, L.deny, L.once], cancelButton: L.back, defaultButton: L.once,
    timeoutSec: TIMEOUT,
  });

  // Back / Esc / timeout / dismiss → abstain (no output) → native prompt gates it.
  if (clicked === null || clicked === L.back) return;
  if (clicked === L.deny) return void process.stdout.write(DENY);
  return void process.stdout.write(ALLOW); // Allow this one request
}

main().catch(() => process.exit(0));
