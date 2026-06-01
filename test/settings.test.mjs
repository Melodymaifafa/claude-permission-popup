import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  addHook, removeHook, hookEntry, hookCommand, isOurHook,
  readSettings, writeSettings, updateSettings,
} from "../src/settings.mjs";

const CMD = "/usr/local/bin/node /Users/me/.claude/hooks/claude-permission-popup/hook.mjs";

// Append a "Z" to permissions.allow — a tiny mutation to exercise the
// read-modify-write / locking paths without depending on any rule builder.
const addZ = (z) => (s) => ({ ...s, permissions: { allow: [...(s.permissions?.allow ?? []), z] } });

test("hookCommand builds <node> <home>/.../hook.mjs", () => {
  assert.equal(
    hookCommand("/opt/homebrew/bin/node", "/Users/me"),
    "/opt/homebrew/bin/node /Users/me/.claude/hooks/claude-permission-popup/hook.mjs",
  );
});

test("isOurHook matches by script path regardless of node binary", () => {
  assert.equal(isOurHook({ command: CMD }), true);
  assert.equal(isOurHook({ command: "node ~/.claude/hooks/claude-permission-popup/hook.mjs" }), true);
  assert.equal(isOurHook({ command: "bash ~/.claude/hooks/notify-on-permission.sh" }), false);
});

test("addHook is idempotent across different node paths, preserves other hooks", () => {
  const base = { hooks: { PermissionRequest: [{ matcher: "x", hooks: [{ type: "command", command: "other" }] }] } };
  const once = addHook(base, CMD);
  // second add with a DIFFERENT node binary must still dedup (same script).
  const twice = addHook(once, "/opt/homebrew/bin/node /Users/me/.claude/hooks/claude-permission-popup/hook.mjs");
  assert.equal(once.hooks.PermissionRequest.length, 2);
  assert.equal(twice.hooks.PermissionRequest.length, 2, "no duplicate on second add");
  assert.ok(once.hooks.PermissionRequest.some((e) => e.hooks.some((h) => h.command === "other")), "kept other hook");
  assert.ok(once.hooks.PermissionRequest.some((e) => e.hooks.some(isOurHook)), "added ours");
});

test("addHook on empty settings", () => {
  const s = addHook({}, CMD);
  assert.deepEqual(s.hooks.PermissionRequest, [hookEntry(CMD)]);
});

test("removeHook removes only ours, drops empty entries", () => {
  const s = addHook({ hooks: { PermissionRequest: [{ matcher: "x", hooks: [{ type: "command", command: "other" }] }] } }, CMD);
  const r = removeHook(s);
  assert.equal(r.hooks.PermissionRequest.length, 1);
  assert.equal(r.hooks.PermissionRequest[0].hooks[0].command, "other");
});

test("removeHook deletes the key when nothing left", () => {
  const r = removeHook(addHook({}, CMD));
  assert.equal(r.hooks.PermissionRequest, undefined);
});

test("read/write round-trip with backup + atomicity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cpp-"));
  const p = join(dir, "settings.json");
  await writeFile(p, JSON.stringify({ permissions: { allow: ["X"] } }));
  const s = await readSettings(p);
  await writeSettings(p, addZ("Y")(s));
  assert.deepEqual((await readSettings(p)).permissions.allow, ["X", "Y"]);
  assert.ok(existsSync(p + ".bak"), "backup written");
  assert.ok(!existsSync(p + ".tmp"), "temp file renamed away");
  await rm(dir, { recursive: true, force: true });
});

test("readSettings returns {} when file absent or empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cpp-"));
  assert.deepEqual(await readSettings(join(dir, "nope.json")), {});
  const empty = join(dir, "empty.json");
  await writeFile(empty, "   ");
  assert.deepEqual(await readSettings(empty), {});
  await rm(dir, { recursive: true, force: true });
});

test("updateSettings applies the mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cpp-"));
  const p = join(dir, "settings.json");
  await writeFile(p, JSON.stringify({ permissions: { allow: ["X"] } }));
  await updateSettings(p, addZ("Y"));
  assert.deepEqual((await readSettings(p)).permissions.allow, ["X", "Y"]);
  await rm(dir, { recursive: true, force: true });
});

// Regression test for the read-modify-write race: concurrent install/uninstall
// runs must not clobber each other. With bare readSettings()+writeSettings()
// this loses writes; updateSettings()'s lock serializes them so all survive.
test("updateSettings serializes concurrent writers — zero lost writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cpp-"));
  const p = join(dir, "settings.json");
  await writeFile(p, JSON.stringify({ permissions: { allow: ["BASE"] } }));
  const N = 12;
  await Promise.all(Array.from({ length: N }, (_, i) => updateSettings(p, addZ(`W_${i}`))));
  const allow = (await readSettings(p)).permissions.allow;
  assert.ok(allow.includes("BASE"), "base preserved");
  for (let i = 0; i < N; i++) assert.ok(allow.includes(`W_${i}`), `W_${i} survived`);
  assert.equal(allow.length, N + 1, "exactly BASE + N entries, no losses");
  await rm(dir, { recursive: true, force: true });
});
