import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the real hook end to end, but against a stub osascript: no dialog ever
// reaches the screen. The hook runs from a temp copy of src/ with a fresh update
// cache, so the npm check neither hits the network nor writes into the repo.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const ALLOW = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
const line = (o) => JSON.stringify(o) + "\n";

function runHook({ firstMessage, toolName, toolInput }) {
  const dir = mkdtempSync(join(tmpdir(), "cpp-hook-"));
  const app = join(dir, "app");
  cpSync(SRC, app, { recursive: true });
  writeFileSync(join(app, ".update-cache.json"), JSON.stringify({ lastCheck: Date.now(), latest: "" }));
  const marker = join(dir, "osascript-called");
  const stub = join(dir, "osascript");
  // Records its argv (argv 2 = the dialog message) and "clicks" Allow.
  writeFileSync(stub, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' "$@" > "${marker}"\necho Allow\n`);
  chmodSync(stub, 0o755);
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, line({ type: "user", message: { role: "user", content: firstMessage } }));
  const hookDir = join(dir, "hookdir");
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(app, "hook.mjs")], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, transcript_path: transcript, cwd: "/Users/x/projects/demo" }),
    env: { ...process.env, CLAUDE_POPUP_OSASCRIPT: stub, CLAUDE_POPUP_HOOK_DIR: hookDir, CLAUDE_POPUP_SOUND: "" },
    encoding: "utf8",
    timeout: 10_000,
  });
  const log = join(hookDir, "skipped-scheduled.log");
  return {
    ...r, ms: Date.now() - t0,
    dialogArgs: existsSync(marker) ? readFileSync(marker, "utf8") : null,
    log: existsSync(log) ? readFileSync(log, "utf8") : null,
  };
}

const UPDATE_TASK = "mcp__scheduled-tasks__update_scheduled_task";

test("a scheduled-task run abstains at once: no dialog, no output, one log line", () => {
  const r = runHook({
    firstMessage: '<scheduled-task name="x" file="/tmp/x/SKILL.md">\nThis is an automated run',
    toolName: UPDATE_TASK, toolInput: { taskId: "x", enabled: false },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.dialogArgs, null, "osascript must not be called");
  assert.ok(r.ms < 1000, `took ${r.ms} ms`);
  const lines = r.log.trim().split("\n");
  assert.equal(lines.length, 1);
  const [time, task, tool] = lines[0].split("\t");
  assert.ok(!Number.isNaN(Date.parse(time)));
  assert.equal(task, "x");
  assert.equal(tool, UPDATE_TASK);
});

test("a normal session still gets the dialog", () => {
  const r = runHook({ firstMessage: "please tidy the repo", toolName: UPDATE_TASK, toolInput: { taskId: "x", enabled: false } });
  assert.equal(r.status, 0);
  assert.ok(r.dialogArgs !== null, "osascript must be called");
  // the dialog message names the folder and the arguments
  assert.match(r.dialogArgs, /：demo\n|: demo\n/);
  assert.match(r.dialogArgs, /\ntaskId=x\nenabled=false\n/);
  assert.equal(r.stdout, ALLOW);
  assert.equal(r.log, null);
});
