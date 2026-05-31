import { readFile, writeFile, rename, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const MATCHER = "*";
const TIMEOUT = 7200;
// Match our hook by its script path, NOT the full command — the node binary
// prefix varies per machine (we bake in an absolute path at install time).
const SCRIPT_MARKER = "claude-permission-popup/hook.mjs";

// Full hook command: absolute node binary + absolute script path. Baking the
// node path in avoids the "node not on the hook's PATH → hook never runs" trap.
export function hookCommand(nodeBin, home) {
  return `${nodeBin} ${home}/.claude/hooks/claude-permission-popup/hook.mjs`;
}

export function hookEntry(command) {
  return { matcher: MATCHER, hooks: [{ type: "command", command, timeout: TIMEOUT }] };
}

export function isOurHook(h) {
  return typeof h?.command === "string" && h.command.includes(SCRIPT_MARKER);
}

export function addHook(settings, command) {
  const s = structuredClone(settings);
  s.hooks ??= {};
  s.hooks.PermissionRequest ??= [];
  const present = s.hooks.PermissionRequest.some((e) => (e.hooks || []).some(isOurHook));
  if (!present) s.hooks.PermissionRequest.push(hookEntry(command));
  return s;
}

export function removeHook(settings) {
  const s = structuredClone(settings);
  const list = s.hooks?.PermissionRequest;
  if (!list) return s;
  s.hooks.PermissionRequest = list
    .map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !isOurHook(h)) }))
    .filter((e) => (e.hooks || []).length > 0);
  if (s.hooks.PermissionRequest.length === 0) delete s.hooks.PermissionRequest;
  return s;
}

export function addAllowRule(settings, rule) {
  const s = structuredClone(settings);
  s.permissions ??= {};
  s.permissions.allow ??= [];
  if (rule && !s.permissions.allow.includes(rule)) s.permissions.allow.push(rule);
  return s;
}

export async function readSettings(path) {
  if (!existsSync(path)) return {};
  const txt = await readFile(path, "utf8");
  if (txt.trim() === "") return {};
  return JSON.parse(txt);
}

// Backup (.bak) → write temp → atomic rename. Never partially writes settings.json.
export async function writeSettings(path, settings) {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) await copyFile(path, path + ".bak");
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n");
  await rename(tmp, path);
}
