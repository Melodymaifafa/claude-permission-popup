import { openSync, fstatSync, closeSync } from "node:fs";
import { readAt } from "./watch.mjs";

// Claude Desktop runs a scheduled task as an ordinary session whose first user
// message is the task prompt, wrapped in <scheduled-task name="…">. A run with
// no project folder gets a <system-reminder> block in front of it. Nobody is
// watching such a run: Desktop does not take our "allow" for it, so a popup
// there is pure noise (clicking Allow on a task closing itself did nothing).
// The hook spots these runs here and stays out of them.

// The first user line comes after the attachment lines (~100 KB in practice),
// so read the head of the transcript generously — but never the whole file.
const HEAD_BYTES = 1024 * 1024;
const TASK_TAG = /^\s*(?:<system-reminder>[\s\S]*?<\/system-reminder>\s*)*<scheduled-task name="([^"]*)"/;

// Text of the first real (non-meta) user message in transcript JSONL, or null
// if there is none in `text`. Content is a string or an array of parts. Pure.
export function firstUserText(text) {
  for (const line of text.split("\n")) {
    if (!line.includes('"user"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; } // partial or foreign line
    if (e?.type !== "user" || e.isMeta) continue;
    const c = e.message?.content;
    if (typeof c === "string") return c;
    return Array.isArray(c) ? c.filter((p) => p?.type === "text").map((p) => p.text).join("\n") : "";
  }
  return null;
}

// The scheduled task name if the transcript's first user message opens with
// <scheduled-task name="…"> (after any system reminders), else null. Never
// throws: a missing or unreadable transcript returns null, so the popup still
// shows.
export function scheduledTaskName(path) {
  if (!path) return null;
  let fd = null;
  try {
    fd = openSync(path, "r");
    const text = readAt(fd, 0, Math.min(fstatSync(fd).size, HEAD_BYTES)).toString("utf8");
    return firstUserText(text)?.match(TASK_TAG)?.[1] ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch {} }
  }
}
