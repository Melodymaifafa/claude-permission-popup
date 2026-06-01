import { readFile, writeFile, rename, copyFile, mkdir, open, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

// File-lock tuning. Concurrent `claude-permission-popup install`/`uninstall`
// runs both read-modify-write settings.json; without a lock the last writer
// wins and silently drops the other's change.
const LOCK_STALE_MS = 10_000; // a lock older than this is presumed abandoned (holder crashed)
const LOCK_TIMEOUT_MS = 5_000; // give up acquiring after this; fall back to unlocked write
const LOCK_RETRY_MS = 25;      // poll interval while the lock is held

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Acquire a cross-process exclusive lock by atomically creating a lockfile
// (O_EXCL via the "wx" flag). Returns a release() function. A stale lock (older
// than LOCK_STALE_MS — its holder probably crashed) is reaped. If the lock
// can't be taken within LOCK_TIMEOUT_MS we give up and proceed UNLOCKED: a
// permission decision must never hang on a stuck lock — worst case we degrade
// to the old last-writer-wins behavior, which is no worse than before.
async function acquireLock(path) {
  const lockPath = path + ".lock";
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fh = await open(lockPath, "wx");
      await fh.close();
      return async () => { try { await unlink(lockPath); } catch {} };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        const st = await stat(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { await unlink(lockPath).catch(() => {}); continue; }
      } catch { continue; } // lock vanished between open and stat — retry immediately
      if (Date.now() >= deadline) return async () => {}; // give up; proceed unlocked
      await sleep(LOCK_RETRY_MS);
    }
  }
}

// Read-modify-write settings.json under an exclusive lock so concurrent
// install/uninstall runs don't clobber each other. `mutate(current)` returns
// the next settings object. This is the ONLY safe way to persist — bare
// readSettings()+writeSettings() races.
export async function updateSettings(path, mutate) {
  const release = await acquireLock(path);
  try {
    await writeSettings(path, mutate(await readSettings(path)));
  } finally {
    await release();
  }
}
