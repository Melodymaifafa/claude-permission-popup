import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sameInput, findRequest, hasResult, watchTranscript } from "../src/watch.mjs";

// One transcript line per content block, like Claude Code writes them; `turn`
// is the API message id shared by the parallel calls of one assistant turn.
const use = (id, name, input, turn = `msg_${id}`) => ({ type: "assistant", message: { id: turn, role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id, timestamp) => ({ type: "user", timestamp, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
const line = (o) => JSON.stringify(o) + "\n";
// The hook start; results without a timestamp are history against it.
const SINCE = Date.parse("2026-01-01T00:00:10Z");
const FRESH = "2026-01-01T00:00:11Z";

test("sameInput ignores key order", () => {
  assert.ok(sameInput({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }));
  assert.ok(!sameInput({ a: 1 }, { a: 2 }));
});

test("findRequest: latest unresolved exact match wins over older resolved twins", () => {
  const entries = [
    use("t1", "Bash", { command: "git status" }), result("t1"),
    use("t2", "Bash", { command: "git status" }),
    use("t3", "Bash", { command: "ls" }),
  ];
  assert.equal(findRequest(entries, "Bash", { command: "git status" }, SINCE), "t2");
  assert.equal(findRequest(entries, "Bash", { command: "ls" }, SINCE), "t3");
});

test("findRequest: falls back to name-only when input was rewritten", () => {
  const entries = [use("t1", "Bash", { command: "rm -rf x" })];
  assert.equal(findRequest(entries, "Bash", { command: "rm -rf x", rewritten: true }, SINCE), "t1");
});

test("findRequest: null when nothing is pending; with no `since` every result counts", () => {
  const entries = [use("t1", "Bash", { command: "ls" }), result("t1")];
  assert.equal(findRequest(entries, "Bash", { command: "ls" }, SINCE), null);
  assert.equal(findRequest(entries, "Edit", {}, SINCE), null);
  assert.equal(findRequest(entries, "Bash", { command: "ls" }), "t1");
});

test("findRequest: a finished sibling in the same turn does not hide the pending call", () => {
  // separate lines sharing a message id (what Claude Code writes today)…
  const lines = [use("r1", "Read", { file_path: "/a" }, "m1"), use("b1", "Bash", { command: "ls" }, "m1"), result("r1")];
  assert.equal(findRequest(lines, "Bash", { command: "ls" }, SINCE), "b1");
  // …and several blocks on one line
  const oneLine = [{ type: "assistant", message: { id: "m1", content: [
    { type: "tool_use", id: "b1", name: "Bash", input: { command: "a" } },
    { type: "tool_use", id: "b2", name: "Bash", input: { command: "b" } },
  ] } }, result("b1")];
  assert.equal(findRequest(oneLine, "Bash", { command: "b" }, SINCE), "b2");
});

test("findRequest: identical pending calls in one turn → the earliest (they run in order)", () => {
  const entries = [use("d1", "Bash", { command: "git status" }, "m1"), use("d2", "Bash", { command: "git status" }, "m1")];
  assert.equal(findRequest(entries, "Bash", { command: "git status" }, SINCE), "d1");
  assert.equal(findRequest([...entries, result("d1")], "Bash", { command: "git status" }, SINCE), "d2");
  // an answered twin, even a fresh one, yields to the unanswered call after it
  assert.equal(findRequest([...entries, result("d1", FRESH)], "Bash", { command: "git status" }, SINCE), "d2");
  // name-only fallback follows the same order
  assert.equal(findRequest(entries, "Bash", { command: "rewritten" }, SINCE), "d1");
});

test("findRequest: a stale unresolved call from an older turn loses to the newest turn", () => {
  const entries = [use("stale", "Bash", { command: "ls" }, "m1"), use("cur", "Bash", { command: "ls" }, "m2")];
  assert.equal(findRequest(entries, "Bash", { command: "ls" }, SINCE), "cur");
  // also when the newest call is already answered
  assert.equal(findRequest([...entries, result("cur", FRESH)], "Bash", { command: "ls" }, SINCE), "cur");
});

test("findRequest: a call answered after `since` counts, history before it does not", () => {
  const old = "2026-01-01T00:00:00Z";
  const history = [use("t1", "Bash", { command: "ls" }, "m1"), result("t1", old)];
  assert.equal(findRequest(history, "Bash", { command: "ls" }, SINCE), null);
  assert.equal(findRequest([...history, use("t2", "Bash", { command: "ls" }, "m2"), result("t2", FRESH)], "Bash", { command: "ls" }, SINCE), "t2");
  assert.equal(findRequest([use("t3", "Bash", { command: "ls" }), result("t3")], "Bash", { command: "ls" }, SINCE), null, "no timestamp = history");
});

test("findRequest: an exact match answered since start beats a pending call that only shares the name", () => {
  const status = { command: "git status" };
  const sleep = use("s1", "Bash", { command: "sleep 30" }, "m1");
  assert.equal(findRequest([sleep, use("g1", "Bash", status, "m2"), result("g1", FRESH)], "Bash", status, SINCE), "g1");
  // same turn, as parallel calls
  assert.equal(findRequest([sleep, use("g1", "Bash", status, "m1"), result("g1", FRESH)], "Bash", status, SINCE), "g1");
  // with no `since` (the batch appended after the dialog opened)
  assert.equal(findRequest([sleep, use("g1", "Bash", status, "m1"), result("g1")], "Bash", status), "g1");
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

test("watchTranscript finishes a tool_use line that was half written at start", async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "t.jsonl");
  const half = line(use("h1", "Bash", { command: "ls" }));
  writeFileSync(path, line(use("old", "Bash", { command: "ls" })) + line(result("old")) + half.slice(0, 40));
  let why = null;
  const stop = watchTranscript({ path, toolName: "Bash", toolInput: { command: "ls" }, onResolved: (w) => (why = w), intervalMs: 15 });
  t.after(stop);
  await new Promise((r) => setTimeout(r, 40));
  appendFileSync(path, half.slice(40));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(why, null, "must not fire before a result lands");
  appendFileSync(path, line(result("h1")));
  await waitFor(() => why !== null);
  assert.equal(why, "resolved");
});

test("watchTranscript fires when the request was already answered before it started", async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "t.jsonl");
  writeFileSync(path, line(use("cur", "Bash", { command: "ls" })) + line(result("cur", FRESH)));
  let why = null;
  const stop = watchTranscript({ path, toolName: "Bash", toolInput: { command: "ls" }, onResolved: (w) => (why = w), intervalMs: 15, since: SINCE });
  t.after(stop);
  await waitFor(() => why !== null);
  assert.equal(why, "resolved");
});

test("watchTranscript fires for a request answered before it started, past an unrelated pending call", async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "t.jsonl");
  writeFileSync(path, line(use("s1", "Bash", { command: "sleep 30" }, "m1"))
    + line(use("g1", "Bash", { command: "git status" }, "m2")) + line(result("g1", FRESH)));
  let why = null;
  const stop = watchTranscript({ path, toolName: "Bash", toolInput: { command: "git status" }, onResolved: (w) => (why = w), intervalMs: 15, since: SINCE });
  t.after(stop);
  await waitFor(() => why !== null);
  assert.equal(why, "resolved");
});

test("watchTranscript ignores a twin call answered before it started", async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "t.jsonl");
  writeFileSync(path, line(use("old", "Bash", { command: "ls" })) + line(result("old", "2026-01-01T00:00:01Z")));
  let why = null;
  const stop = watchTranscript({ path, toolName: "Bash", toolInput: { command: "ls" }, onResolved: (w) => (why = w), intervalMs: 15, since: SINCE });
  t.after(stop);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(why, null);
  appendFileSync(path, line(use("cur", "Bash", { command: "ls" })));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(why, null);
  appendFileSync(path, line(result("cur", "2026-01-01T00:00:12Z")));
  await waitFor(() => why !== null);
  assert.equal(why, "resolved");
});

test("watchTranscript keeps retrying until the transcript becomes readable", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "late.jsonl");
  let why = null;
  const stop = watchTranscript({ path, toolName: "Bash", toolInput: { command: "ls" }, onResolved: (w) => (why = w), intervalMs: 15 });
  await new Promise((r) => setTimeout(r, 40));
  writeFileSync(path, line(use("late", "Bash", { command: "ls" })));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(why, null);
  appendFileSync(path, line(result("late")));
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
