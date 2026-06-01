import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cp, rm, mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

// Run the real hook.mjs in a throwaway sandbox: src copied in, dialog.mjs
// stubbed to return whatever CPP_CLICK says (or null for timeout/dismiss/Back),
// HOME pointed at a temp dir so any settings write goes to a throwaway file.
async function runHook({ tool, input = {}, click }) {
  const sb = await mkdtemp(join(tmpdir(), "cpp-hook-"));
  await cp(SRC, sb, { recursive: true });
  await writeFile(join(sb, "dialog.mjs"),
    "export function showDialog(){const v=process.env.CPP_CLICK;return Promise.resolve(v&&v.length?v:null);}\n");
  const home = await mkdtemp(join(tmpdir(), "cpp-home-"));
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: [] } }));

  const stdout = await new Promise((resolve) => {
    const child = execFile(process.execPath, [join(sb, "hook.mjs")],
      { env: { ...process.env, CPP_CLICK: click ?? "", HOME: home } },
      (_e, out) => resolve(out));
    child.stdin.end(JSON.stringify({ tool_name: tool, tool_input: input }));
  });

  let allow = [];
  try { allow = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8")).permissions.allow; } catch {}
  await rm(sb, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
  return { stdout: stdout.trim(), allow };
}

const behavior = (s) => { try { return JSON.parse(s).hookSpecificOutput.decision.behavior; } catch { return null; } };

test("interactive tools are IGNORED — abstain (empty stdout), never allow/deny", async () => {
  // Both built-in tools that render their own UI must fall through so that UI
  // shows; force-allowing either would swallow its choices/plan prompt.
  for (const tool of ["AskUserQuestion", "ExitPlanMode"]) {
    const { stdout } = await runHook({ tool, input: { questions: [] } });
    assert.equal(stdout, "", `${tool} must emit NOTHING so native flow renders its UI`);
  }
});

test("Todo tools are ignored — abstain", async () => {
  for (const tool of ["TodoWrite", "TodoRead"]) {
    const { stdout } = await runHook({ tool, input: {} });
    assert.equal(stdout, "", `${tool} should abstain`);
  }
});

test("timeout / dismiss abstains (empty stdout) — never auto-approves, never hard-denies", async () => {
  const { stdout } = await runHook({ tool: "WebFetch", input: { url: "https://example.com" }, click: "" });
  assert.equal(stdout, "", "timeout falls through to native, per README");
});

test("Back button abstains (empty stdout) → hands off to the native prompt", async () => {
  // On the test machine pickLang() is "en", so the Back label is "Back".
  const { stdout } = await runHook({ tool: "Bash", input: { command: "ls" }, click: "Back" });
  assert.equal(stdout, "", "Back must emit nothing so Claude Code's native prompt takes over");
});

test("explicit Deny click → deny", async () => {
  const { stdout } = await runHook({ tool: "Bash", input: { command: "ls" }, click: "Deny" });
  assert.equal(behavior(stdout), "deny");
});

test("Allow once → allow, and the hook never writes settings.json", async () => {
  const { stdout, allow } = await runHook({ tool: "Bash", input: { command: "ls -la" }, click: "Allow once" });
  assert.equal(behavior(stdout), "allow");
  assert.equal(allow.length, 0, "the popup no longer persists any rule — Always is the native prompt's job");
});
