import { openSync, readSync, fstatSync, closeSync } from "node:fs";

// Claude Code never cancels a running PermissionRequest hook once the prompt
// has been answered somewhere else — the mobile app, the terminal, Claude
// Desktop's own permission card. It just stops listening (no SIGTERM, nothing).
// Left alone, our dialog would sit on screen until clicked or until its
// 2-minute timeout. So while the dialog is up, this module watches the session
// transcript for the moment THIS request gets resolved by any channel, and the
// hook closes the dialog itself.
//
// The hook input carries no tool_use_id (only tool_name + tool_input), so the
// pending tool_use is found by matching those against the assistant's tool_use
// blocks already in the transcript. The request counts as resolved once a
// tool_result for that id lands: a deny is written immediately, an allow once
// the tool finishes — so for a long-running command the dialog closes when the
// command ends, not when it starts.

const TAIL_BYTES = 4 * 1024 * 1024; // more than enough to hold the assistant turn owning the request

// Canonical JSON: key order must never break input equality. Pure.
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

export function sameInput(a, b) {
  return canon(a) === canon(b);
}

export function parseLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or foreign line */ }
  }
  return out;
}

function blocks(e, entryType, blockType) {
  const c = e?.type === entryType ? e.message?.content : null;
  return Array.isArray(c) ? c.filter((b) => b?.type === blockType) : [];
}

// Latest assistant tool_use matching the name (and, preferably, the input),
// ignoring whether it already has a result. Pure.
export function findToolUse(entries, toolName, toolInput) {
  const uses = entries.flatMap((e) => blocks(e, "assistant", "tool_use")).filter((u) => u.name === toolName);
  const exact = uses.filter((u) => sameInput(u.input, toolInput));
  return (exact.at(-1) ?? uses.at(-1))?.id ?? null;
}

// Same, but only among tool_uses that have no tool_result yet — the one this
// hook is being asked about. Prefers an exact name+input match; falls back to
// name only because a PreToolUse hook may have rewritten the input. Pure.
export function findPendingToolUse(entries, toolName, toolInput) {
  const done = new Set(entries.flatMap((e) => blocks(e, "user", "tool_result")).map((r) => r.tool_use_id));
  const open = entries.filter((e) => e?.type !== "assistant" || !blocks(e, "assistant", "tool_use").some((u) => done.has(u.id)));
  return findToolUse(open, toolName, toolInput);
}

// True if any entry carries the tool_result for `id`. Pure.
export function hasResult(entries, id) {
  return entries.some((e) => blocks(e, "user", "tool_result").some((r) => r.tool_use_id === id));
}

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, buf, got, len - got, pos + got);
    if (n === 0) break;
    got += n;
  }
  return buf.subarray(0, got);
}

// Poll `path` (the session transcript) every `intervalMs` until the request for
// toolName/toolInput has a tool_result, or until the process that spawned us is
// gone (ppid changed: Claude exited or was killed). Calls onResolved(reason)
// once, with "resolved" or "parent-gone". Returns stop(). Never throws: a
// missing/unreadable transcript just leaves the parent watchdog running.
export function watchTranscript({ path, toolName, toolInput, onResolved, intervalMs = 250, ppid = process.ppid }) {
  let fd = null, offset = 0, carry = Buffer.alloc(0), id = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    let text = readAt(fd, start, size - start).toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop the partial first line
    id = findPendingToolUse(parseLines(text), toolName, toolInput);
    offset = size;
  } catch {
    if (fd !== null) { try { closeSync(fd); } catch {} }
    fd = null;
  }

  const timer = setInterval(() => {
    if (process.ppid !== ppid) return finish("parent-gone");
    if (fd === null) return;
    let size;
    try { size = fstatSync(fd).size; } catch { return; }
    if (size < offset) { offset = 0; carry = Buffer.alloc(0); } // truncated / rotated
    if (size === offset) return;
    let chunk;
    try { chunk = readAt(fd, offset, size - offset); } catch { return; }
    offset += chunk.length;
    carry = Buffer.concat([carry, chunk]);
    const nl = carry.lastIndexOf(0x0a);
    if (nl < 0) return; // no complete line yet (a huge line may span polls)
    const entries = parseLines(carry.subarray(0, nl).toString("utf8"));
    carry = carry.subarray(nl + 1);
    // Everything appended after the dialog opened belongs to this request (the
    // conversation is blocked on it), so a tool_use appearing now is ours even
    // if its result lands in the same batch.
    if (id === null) id = findPendingToolUse(entries, toolName, toolInput) ?? findToolUse(entries, toolName, toolInput);
    if (id !== null && hasResult(entries, id)) finish("resolved");
  }, intervalMs);

  function finish(why) { stop(); onResolved(why); }
  function stop() {
    clearInterval(timer);
    if (fd !== null) { try { closeSync(fd); } catch {} fd = null; }
  }
  return stop;
}
