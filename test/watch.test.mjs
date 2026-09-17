import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sameInput, findToolUse, findPendingToolUse, hasResult, watchTranscript } from "../src/watch.mjs";

const use = (id, name, input) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
const line = (o) => JSON.stringify(o) + "\n";

test("sameInput ignores key order", () => {
  assert.ok(sameInput({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }));
  assert.ok(!sameInput({ a: 1 }, { a: 2 }));
});

test("findPendingToolUse: latest unresolved exact match wins over older resolved twins", () => {
  const entries = [
    use("t1", "Bash", { command: "git status" }), result("t1"),
    use("t2", "Bash", { command: "git status" }),
    use("t3", "Bash", { command: "ls" }),
  ];
  assert.equal(findPendingToolUse(entries, "Bash", { command: "git status" }), "t2");
  assert.equal(findPendingToolUse(entries, "Bash", { command: "ls" }), "t3");
});

test("findPendingToolUse: falls back to name-only when input was rewritten", () => {
  const entries = [use("t1", "Bash", { command: "rm -rf x" })];
  assert.equal(findPendingToolUse(entries, "Bash", { command: "rm -rf x", rewritten: true }), "t1");
});

test("findPendingToolUse: null when nothing is pending; findToolUse ignores results", () => {
  const entries = [use("t1", "Bash", { command: "ls" }), result("t1")];
  assert.equal(findPendingToolUse(entries, "Bash", { command: "ls" }), null);
  assert.equal(findPendingToolUse(entries, "Edit", {}), null);
  assert.equal(findToolUse(entries, "Bash", { command: "ls" }), "t1");
});

test("hasResult", () => {
  assert.ok(hasResult([result("t1")], "t1"));
  assert.ok(!hasResult([result("t1"), use("t2", "Bash", {})], "t2"));
});

const waitFor = (fn, ms = 2000) => new Promise((res, rej) => {
  const t0 = Date.now();
  (function tick() { if (fn()) return res(); if (Date.now() - t0 > ms) return rej(new Error("timed out")); setTimeout(tick, 10); })();
});

test("watchTranscript fires once the pending request gets its tool_result", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "t.jsonl");
  writeFileSync(path, line(use("old", "Bash", { command: "ls" })) + line(result("old")) + line(use("cur", "Bash", { command: "ls" })));
  let why = null;
  const stop = watchTranscript({ path, toolName: "Bash", toolInput: { command: "ls" }, onResolved: (w) => (why = w), intervalMs: 15 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(why, null, "must not fire before a result lands");
  appendFileSync(path, line(result("old")));      // a stale duplicate result: not ours
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(why, null);
  appendFileSync(path, line(result("cur")));
  await waitFor(() => why !== null);
  assert.equal(why, "resolved");
  stop();
});

test("watchTranscript copes with the tool_use and its result arriving after start, in one write", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "t.jsonl");
  writeFileSync(path, "");
  let why = null;
  const stop = watchTranscript({ path, toolName: "Edit", toolInput: { file_path: "/a" }, onResolved: (w) => (why = w), intervalMs: 15 });
  await new Promise((r) => setTimeout(r, 40));
  appendFileSync(path, line(use("e1", "Edit", { file_path: "/a" })) + line(result("e1")));
  await waitFor(() => why !== null);
  assert.equal(why, "resolved");
  stop();
});

test("watchTranscript fires parent-gone when the ppid no longer matches, even without a transcript", async () => {
  let why = null;
  const stop = watchTranscript({ path: "/nonexistent/t.jsonl", toolName: "Bash", toolInput: {}, onResolved: (w) => (why = w), intervalMs: 15, ppid: -1 });
  await waitFor(() => why !== null);
  assert.equal(why, "parent-gone");
  stop();
});
