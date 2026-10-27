import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMessage, riskySegment } from "../src/message.mjs";

// The three long Bash requests she approved on 2026-10-11 at 16:43 (476 / 686 /
// 761 chars), copied from her session transcript. The old dialog cut each one
// at 240 chars and never said how much was left.
const LONG = JSON.parse(readFileSync(new URL("./fixtures/long-commands-2026-10-11.json", import.meta.url), "utf8"));

test("a non-Bash tool shows its arguments as key=value (the 10-25 update_scheduled_task popup)", () => {
  const text = buildMessage({
    toolName: "mcp__scheduled-tasks__update_scheduled_task",
    toolInput: { taskId: "momo-standalone-rollout", enabled: false },
    cwd: "/Users/x/projects/linear-agent-team", lang: "en",
  });
  assert.equal(text, "Allow mcp__scheduled-tasks__update_scheduled_task?\nFrom folder: linear-agent-team\n\ntaskId=momo-standalone-rollout\nenabled=false");
});

test("key=value: at most 3 lines, long values cut, objects as JSON, newlines flattened", () => {
  const text = buildMessage({
    toolName: "mcp__x__y",
    toolInput: { prompt: "line one\nline two " + "z".repeat(200), opts: { a: 1 }, n: 3, extra: 1, more: 2 },
    lang: "en",
  });
  const lines = text.split("\n\n")[1].split("\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith("prompt=line one line two zzz") && lines[0].endsWith("…"));
  assert.ok(lines[0].length <= "prompt=".length + 80);
  assert.equal(lines[1], 'opts={"a":1}');
  assert.equal(lines[2], "n=3");
  assert.equal(lines[3], "…2 more fields");
});

test("each long 10-11 command shows its rm segment on its own line, then the head and how much is left", () => {
  for (const command of LONG) {
    const text = buildMessage({ toolName: "Bash", toolInput: { command }, lang: "zh" });
    const [title, risky, head] = text.split("\n\n");
    assert.equal(title, "是否允许使用 Bash？");
    assert.match(risky, /^⚠️ rm -f "\$OUT"$/);
    assert.ok(head.startsWith(command.slice(0, 240)));
    assert.ok(head.endsWith(`…后面还有 ${command.length - 240} 字`), head.slice(-30));
  }
});

test("a risky segment past the cut is still visible", () => {
  const command = `cd /tmp/build && echo ${"x".repeat(300)} && rm -rf ./dist`;
  const text = buildMessage({ toolName: "Bash", toolInput: { command }, lang: "en" });
  assert.ok(!command.slice(0, 240).includes("rm -rf"));
  assert.ok(text.includes("⚠️ rm -rf ./dist\n\n"));
  assert.ok(text.endsWith(`…${command.length - 240} more chars`));
});

test("a long command with nothing risky shows only the head and the note", () => {
  const command = `echo ${"y".repeat(400)}`;
  assert.equal(buildMessage({ toolName: "Bash", toolInput: { command }, lang: "en" }),
    `Allow Bash?\n\n${command.slice(0, 240)}…${command.length - 240} more chars`);
});

test("riskySegment: first risky segment, split on && || ; | and newlines", () => {
  assert.equal(riskySegment('OUT=x; rm -f "$OUT"\nls'), 'rm -f "$OUT"');
  assert.equal(riskySegment("ls | xargs rm || sudo reboot"), "sudo reboot");
  assert.equal(riskySegment("git status && git push origin main"), "git push origin main");
  assert.equal(riskySegment("for f in *; do rm $f; done"), "do rm $f");
  assert.equal(riskySegment("echo rm; format && grep rmdir x"), "");
});

test("who is asking: the scheduled task, else the session folder, else nothing", () => {
  const ask = (extra) => buildMessage({ toolName: "Bash", toolInput: { command: "ls" }, ...extra });
  assert.equal(ask({ taskName: "momo-standalone-rollout", cwd: "/a/b", lang: "en" }), "Allow Bash?\nFrom scheduled task: momo-standalone-rollout\n\nls");
  assert.equal(ask({ taskName: "momo-standalone-rollout", lang: "zh" }), "是否允许使用 Bash？\n来自定时任务：momo-standalone-rollout\n\nls");
  assert.equal(ask({ cwd: "/Users/x/projects/claude-permission-popup/", lang: "zh" }), "是否允许使用 Bash？\n来自文件夹：claude-permission-popup\n\nls");
  assert.equal(ask({ cwd: "/", lang: "en" }), "Allow Bash?\n\nls");
});

test("short Bash, file and URL requests read as before", () => {
  assert.equal(buildMessage({ toolName: "Bash", toolInput: { command: "ls -la" }, lang: "en" }), "Allow Bash?\n\nls -la");
  assert.equal(buildMessage({ toolName: "Edit", toolInput: { file_path: "/a/b.txt", old_string: "x" }, lang: "en" }), "Allow Edit?\n\n/a/b.txt");
  assert.equal(buildMessage({ toolName: "WebFetch", toolInput: { url: "https://x.dev", prompt: "p" }, lang: "zh" }), "是否允许使用 WebFetch？\n\nhttps://x.dev");
  assert.equal(buildMessage({ toolName: "", toolInput: {}, lang: "en" }), "Allow this action?");
  assert.equal(buildMessage({ toolName: "Edit", lang: "zh" }), "是否允许使用 Edit？");
});

test("a long file path gets the note but no risky line; Chinese field note", () => {
  const file_path = "/" + "d/".repeat(200);
  const text = buildMessage({ toolName: "Write", toolInput: { file_path }, lang: "zh" });
  assert.equal(text, `是否允许使用 Write？\n\n${file_path.slice(0, 240)}…后面还有 ${file_path.length - 240} 字`);
  assert.ok(buildMessage({ toolName: "T", toolInput: { a: 1, b: 2, c: 3, d: 4 }, lang: "zh" }).endsWith("…另有 1 项参数"));
});

test("the whole text is capped", () => {
  const text = buildMessage({ toolName: "x".repeat(5000), toolInput: { ["k".repeat(5000)]: "v" }, cwd: "/" + "f".repeat(5000), lang: "en" });
  assert.ok(text.length <= 1500);
});
