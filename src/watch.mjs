import { openSync, readSync, fstatSync, closeSync } from "node:fs";

// Claude Code never cancels a running PermissionRequest hook once the prompt
// has been answered somewhere else — the mobile app, the terminal, Claude
// Desktop's own permission card. It just stops listening (no SIGTERM, nothing).
// Left alone, our dialog would sit on screen until clicked — it has no
// auto-dismiss, only a give-up deadline hours out that exists to avoid an
// orphaned window (see hook.mjs). So while the dialog is up, this module watches
// the session transcript for the moment THIS request gets resolved by any
// channel, and the hook closes the dialog itself.
//
// The hook input carries no tool_use_id (only tool_name + tool_input), so the
// pending tool_use is found by matching those against the assistant's tool_use
// blocks already in the transcript. The request counts as resolved once a
// tool_result for that id lands: a deny is written immediately, an allow once
// the tool finishes — so for a long-running command the dialog closes when the
// command ends, not when it starts.

const TAIL_BYTES = 4 * 1024 * 1024; // more than enough to hold the assistant turn owning the request
// How far before the hook's start a tool_result still counts as the answer to
// this request: covers node startup, and is far shorter than any human answer
// plus the model turn that must separate it from an older identical call.
const START_SLACK_MS = 1000;

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

// Only lines carrying a tool_use / tool_result matter; skipping the rest before
// JSON.parse keeps big attachment / snapshot lines out of the hot path.
export function parseLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or foreign line */ }
  }
  return out;
}

function blocks(e, entryType, blockType) {
  const c = e?.type === entryType ? e.message?.content : null;
  return Array.isArray(c) ? c.filter((b) => b?.type === blockType) : [];
}

const resultIds = (entries) => new Set(entries.flatMap((e) => blocks(e, "user", "tool_result")).map((r) => r.tool_use_id));

// The tool_use this hook is asked about. Candidates are the calls with no
// tool_result yet, plus those answered at or after `since`: the request may
// already be answered when the watcher first looks (elsewhere while the hook
// started, or while the transcript was unreadable). Older results, and results
// without a timestamp, are history; with no `since`, every result counts.
// Calls whose input matches exactly come first, else (a PreToolUse hook may
// have rewritten the input) every call with the name — so a stale unanswered
// call of the same tool never captures a request already answered.
// Claude Code writes one transcript line per content block, so the parallel
// tool calls of one assistant turn are separate lines sharing `message.id`.
// Among the candidates the NEWEST turn wins (older leftovers are stale); within
// it an unanswered call beats an answered one, then the EARLIEST call, because
// calls run in the order they were issued. Pure.
export function findRequest(entries, toolName, toolInput, since) {
  const answered = resultIds(entries);
  const fresh = since === undefined ? answered : resultIds(entries.filter((e) => Date.parse(e.timestamp) >= since));
  const uses = entries.flatMap((e) => blocks(e, "assistant", "tool_use").map((u) => ({ ...u, turn: e.message?.id })))
    .filter((u) => u.name === toolName && (!answered.has(u.id) || fresh.has(u.id)));
  const exact = uses.filter((u) => sameInput(u.input, toolInput));
  const pool = exact.length ? exact : uses;
  if (!pool.length) return null;
  const turn = pool.filter((u) => u.turn === pool.at(-1).turn);
  return (turn.find((u) => !answered.has(u.id)) ?? turn[0]).id;
}

// True if any entry carries the tool_result for `id`. Pure.
export function hasResult(entries, id) {
  return entries.some((e) => blocks(e, "user", "tool_result").some((r) => r.tool_use_id === id));
}

export function readAt(fd, pos, len) {
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
// `since` (ms) = when the hook started; see findRequest.
export function watchTranscript({ path, toolName, toolInput, onResolved, intervalMs = 250, ppid = process.ppid, since = Date.now() - process.uptime() * 1000 }) {
  let fd = null, offset = 0, carry = Buffer.alloc(0), id = null, answered = false;
  // Open + scan the tail for the request. Retried from the tick until it
  // works: the transcript may not be readable yet when the hook starts.
  function tryOpen() {
    if (!path) return;
    try {
      fd = openSync(path, "r");
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      let buf = readAt(fd, start, size - start);
      if (start > 0) buf = buf.subarray(buf.indexOf(0x0a) + 1); // drop the partial first line
      const nl = buf.lastIndexOf(0x0a);
      const entries = parseLines(buf.subarray(0, nl + 1).toString("utf8"));
      id = findRequest(entries, toolName, toolInput, since - START_SLACK_MS);
      answered = id !== null && hasResult(entries, id);
      carry = buf.subarray(nl + 1); // a line still being written: the next poll completes it
      offset = size;
    } catch {
      if (fd !== null) { try { closeSync(fd); } catch {} }
      fd = null;
    }
  }
  tryOpen();

  const timer = setInterval(() => {
    if (process.ppid !== ppid) return finish("parent-gone");
    if (fd === null) tryOpen();
    if (answered) return finish("resolved");
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
    if (id === null) id = findRequest(entries, toolName, toolInput);
    if (id !== null && hasResult(entries, id)) finish("resolved");
  }, intervalMs);

  function finish(why) { stop(); onResolved(why); }
  function stop() {
    clearInterval(timer);
    if (fd !== null) { try { closeSync(fd); } catch {} fd = null; }
  }
  return stop;
}
