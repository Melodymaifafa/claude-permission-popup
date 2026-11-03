import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMessage, riskySegment } from "../src/message.mjs";

// The three long Bash requests she approved on 2026-10-11 at 16:43 (476 / 686 /
// 761 chars), copied from her session transcript. The old dialog cut each one
// at 240 chars and never said how much was left.
const LONG = JSON.parse(readFileSync(new URL("./fixtures/long-commands-2026-10-11.json", import.meta.url), "utf8"));

// The start_session request she allowed on 2026-11-03 at 16:55. Its prompt and
// background text are cut: the dialog never shows them, it only counts them.
const START_SESSION = {
  toolName: "mcp__ccd_session__start_session",
  toolInput: {
    initiation: "own_initiative",
    title: "Modal 冷启动超 150 秒时脚本报 303 退出",
    context: "fresh",
    use_worktree: true,
    branch_name: "modal-303-cold-start",
    prompt: "(cut)",
    background: "(cut)",
  },
  cwd: "/Users/x/projects/wechat-mimic-finetune",
};

const firstLine = (text) => text.split("\n")[0];
const lastLine = (text) => text.split("\n").at(-1);

test("the 11-03 start_session request opens with a plain sentence; the raw name moves under the arguments", () => {
  assert.equal(buildMessage({ ...START_SESSION, lang: "zh" }),
    "要开一个新会话，允许吗？\n来自文件夹：wechat-mimic-finetune\n\ninitiation=own_initiative\ntitle=Modal 冷启动超 150 秒时脚本报 303 退出\ncontext=fresh\n…另有 4 项参数\n\n工具名：mcp__ccd_session__start_session");
  assert.equal(buildMessage({ ...START_SESSION, lang: "en" }),
    "Allow Claude to start a new session?\nFrom folder: wechat-mimic-finetune\n\ninitiation=own_initiative\ntitle=Modal 冷启动超 150 秒时脚本报 303 退出\ncontext=fresh\n…4 more fields\n\nTool: mcp__ccd_session__start_session");
});

test("the 10-25 update_scheduled_task request opens with a plain sentence in both languages", () => {
  const ask = (lang) => buildMessage({
    toolName: "mcp__scheduled-tasks__update_scheduled_task",
    toolInput: { taskId: "momo-standalone-rollout", enabled: false },
    cwd: "/Users/x/projects/linear-agent-team", lang,
  });
  assert.equal(ask("zh"), "要改定时任务，允许吗？\n来自文件夹：linear-agent-team\n\ntaskId=momo-standalone-rollout\nenabled=false\n\n工具名：mcp__scheduled-tasks__update_scheduled_task");
  assert.equal(ask("en"), "Allow Claude to change a scheduled task?\nFrom folder: linear-agent-team\n\ntaskId=momo-standalone-rollout\nenabled=false\n\nTool: mcp__scheduled-tasks__update_scheduled_task");
});

test("each known tool gets its own plain first line; the raw name is the last line", () => {
  const known = [
    ["Bash", "要运行一条命令，允许吗？", "Allow Claude to run a command?"],
    ["Edit", "要改一个文件，允许吗？", "Allow Claude to edit a file?"],
    ["Write", "要新建或覆盖一个文件，允许吗？", "Allow Claude to create or overwrite a file?"],
    ["mcp__ccd_session__start_session", "要开一个新会话，允许吗？", "Allow Claude to start a new session?"],
    ["mcp__scheduled-tasks__update_scheduled_task", "要改定时任务，允许吗？", "Allow Claude to change a scheduled task?"],
    ["mcp__computer-use__request_access", "要操作这台电脑上的应用，允许吗？", "Allow Claude to control apps on this computer?"],
  ];
  for (const [toolName, zh, en] of known) {
    const zhText = buildMessage({ toolName, toolInput: { a: 1 }, lang: "zh" });
    const enText = buildMessage({ toolName, toolInput: { a: 1 }, lang: "en" });
    assert.equal(firstLine(zhText), zh);
    assert.equal(firstLine(enText), en);
    assert.equal(lastLine(zhText), `工具名：${toolName}`);
    assert.equal(lastLine(enText), `Tool: ${toolName}`);
  }
});

test("an unknown MCP tool reads as <server>'s <tool>, without mcp__", () => {
  const zh = buildMessage({ toolName: "mcp__foo__do_thing", toolInput: { a: 1 }, lang: "zh" });
  const en = buildMessage({ toolName: "mcp__foo__do_thing", toolInput: { a: 1 }, lang: "en" });
  assert.equal(firstLine(zh), "是否允许使用 foo 的 do_thing？");
  assert.equal(firstLine(en), "Allow do_thing from foo?");
  assert.equal(zh, "是否允许使用 foo 的 do_thing？\n\na=1\n\n工具名：mcp__foo__do_thing");
  assert.equal(en, "Allow do_thing from foo?\n\na=1\n\nTool: mcp__foo__do_thing");
  // a tool name that is also an Object property is still an unknown tool
  assert.equal(firstLine(buildMessage({ toolName: "mcp__foo__toString", lang: "en" })), "Allow toString from foo?");
});

test("the raw tool name survives the cap", () => {
  const text = buildMessage({ toolName: "mcp__foo__do_thing", toolInput: { ["k".repeat(5000)]: "v" }, cwd: "/" + "f".repeat(5000), lang: "en" });
  assert.ok(text.length <= 1500);
  assert.ok(text.endsWith("\n\nTool: mcp__foo__do_thing"));
});

test("a non-Bash tool shows its arguments as key=value (the 10-25 update_scheduled_task popup)", () => {
  const text = buildMessage({
    toolName: "mcp__scheduled-tasks__update_scheduled_task",
    toolInput: { taskId: "momo-standalone-rollout", enabled: false },
    cwd: "/Users/x/projects/linear-agent-team", lang: "en",
  });
  assert.equal(text, "Allow Claude to change a scheduled task?\nFrom folder: linear-agent-team\n\ntaskId=momo-standalone-rollout\nenabled=false\n\nTool: mcp__scheduled-tasks__update_scheduled_task");
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
    assert.equal(title, "要运行一条命令，允许吗？");
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
  assert.ok(text.endsWith(`…${command.length - 240} more chars\n\nTool: Bash`));
});

test("a long command with nothing risky shows only the head and the note", () => {
  const command = `echo ${"y".repeat(400)}`;
  assert.equal(buildMessage({ toolName: "Bash", toolInput: { command }, lang: "en" }),
    `Allow Claude to run a command?\n\n${command.slice(0, 240)}…${command.length - 240} more chars\n\nTool: Bash`);
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
  assert.equal(ask({ taskName: "momo-standalone-rollout", cwd: "/a/b", lang: "en" }), "Allow Claude to run a command?\nFrom scheduled task: momo-standalone-rollout\n\nls\n\nTool: Bash");
  assert.equal(ask({ taskName: "momo-standalone-rollout", lang: "zh" }), "要运行一条命令，允许吗？\n来自定时任务：momo-standalone-rollout\n\nls\n\n工具名：Bash");
  assert.equal(ask({ cwd: "/Users/x/projects/claude-permission-popup/", lang: "zh" }), "要运行一条命令，允许吗？\n来自文件夹：claude-permission-popup\n\nls\n\n工具名：Bash");
  assert.equal(ask({ cwd: "/", lang: "en" }), "Allow Claude to run a command?\n\nls\n\nTool: Bash");
});

test("short Bash, file and URL requests read as before", () => {
  assert.equal(buildMessage({ toolName: "Bash", toolInput: { command: "ls -la" }, lang: "en" }), "Allow Claude to run a command?\n\nls -la\n\nTool: Bash");
  assert.equal(buildMessage({ toolName: "Edit", toolInput: { file_path: "/a/b.txt", old_string: "x" }, lang: "en" }), "Allow Claude to edit a file?\n\n/a/b.txt\n\nTool: Edit");
  assert.equal(buildMessage({ toolName: "WebFetch", toolInput: { url: "https://x.dev", prompt: "p" }, lang: "zh" }), "是否允许使用 WebFetch？\n\nhttps://x.dev\n\n工具名：WebFetch");
  assert.equal(buildMessage({ toolName: "", toolInput: {}, lang: "en" }), "Allow this action?");
  assert.equal(buildMessage({ toolName: "Edit", lang: "zh" }), "要改一个文件，允许吗？\n\n工具名：Edit");
});

test("a long file path gets the note but no risky line; Chinese field note", () => {
  const file_path = "/" + "d/".repeat(200);
  const text = buildMessage({ toolName: "Write", toolInput: { file_path }, lang: "zh" });
  assert.equal(text, `要新建或覆盖一个文件，允许吗？\n\n${file_path.slice(0, 240)}…后面还有 ${file_path.length - 240} 字\n\n工具名：Write`);
  assert.ok(buildMessage({ toolName: "T", toolInput: { a: 1, b: 2, c: 3, d: 4 }, lang: "zh" }).endsWith("…另有 1 项参数\n\n工具名：T"));
});

test("the whole text is capped", () => {
  const text = buildMessage({ toolName: "x".repeat(5000), toolInput: { ["k".repeat(5000)]: "v" }, cwd: "/" + "f".repeat(5000), lang: "en" });
  assert.ok(text.length <= 1500);
});
