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
  // Stub jump.mjs so the test never actually activates a terminal; instead it
  // records that jumpToTerminal() ran by touching CPP_JUMP_FLAG.
  const jumpFlag = join(sb, "jumped");
  await writeFile(join(sb, "jump.mjs"),
    `import { writeFileSync } from "node:fs";\nexport function jumpToTerminal(){writeFileSync(${JSON.stringify(jumpFlag)},"1");}\n`);
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
  let jumped = false;
  try { await readFile(jumpFlag); jumped = true; } catch {}
  await rm(sb, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
  return { stdout: stdout.trim(), allow, jumped };
}

const behavior = (s) => { try { return JSON.parse(s).hookSpecificOutput.decision.behavior; } catch { return null; } };

test("interactive tools are IGNORED — abstain before any popup, no jump", async () => {
  // Both built-in tools that render their own UI must fall through so that UI
  // shows; force-allowing either would swallow its choices/plan prompt. No
  // popup was shown, so there is nothing to jump back from.
  for (const tool of ["AskUserQuestion", "ExitPlanMode"]) {
    const { stdout, jumped } = await runHook({ tool, input: { questions: [] } });
    assert.equal(stdout, "", `${tool} must emit NOTHING so native flow renders its UI`);
    assert.equal(jumped, false, `${tool} skips the popup entirely — must not jump`);
  }
});

test("Todo tools are ignored — abstain before any popup, no jump", async () => {
  for (const tool of ["TodoWrite", "TodoRead"]) {
    const { stdout, jumped } = await runHook({ tool, input: {} });
    assert.equal(stdout, "", `${tool} should abstain`);
    assert.equal(jumped, false, `${tool} skips the popup entirely — must not jump`);
  }
});

test("timeout / dismiss abstains → jumps back to the terminal", async () => {
  const { stdout, jumped } = await runHook({ tool: "WebFetch", input: { url: "https://example.com" }, click: "" });
  assert.equal(stdout, "", "timeout falls through to native, per README");
  assert.equal(jumped, true, "a dismissed popup must surface the native prompt by raising the terminal");
});

test("Back button abstains → jumps back to the terminal so the native prompt is visible", async () => {
  // On the test machine pickLang() is "en", so the Back label is "Back". The
  // native 1/2/3 prompt renders in the terminal; the jump makes it visible even
  // when the user was looking at another screen.
  const { stdout, jumped } = await runHook({ tool: "Bash", input: { command: "ls" }, click: "Back" });
  assert.equal(stdout, "", "Back must emit nothing so Claude Code's native prompt takes over");
  assert.equal(jumped, true, "Back must raise the terminal — otherwise it looks like a silent cancel");
});

test("explicit Deny click → deny, no jump", async () => {
  const { stdout, jumped } = await runHook({ tool: "Bash", input: { command: "ls" }, click: "Deny" });
  assert.equal(behavior(stdout), "deny");
  assert.equal(jumped, false, "Deny resolves the request in place — no native prompt to jump to");
});

test("Allow → allow, never writes settings.json, no jump", async () => {
  const { stdout, allow, jumped } = await runHook({ tool: "Bash", input: { command: "ls -la" }, click: "Allow" });
  assert.equal(behavior(stdout), "allow");
  assert.equal(allow.length, 0, "the popup no longer persists any rule — Always is the native prompt's job");
  assert.equal(jumped, false, "Allow resolves the request in place — no native prompt to jump to");
});
