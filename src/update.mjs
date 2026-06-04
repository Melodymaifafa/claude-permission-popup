import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { labels } from "./i18n.mjs";

// Lightweight "a newer version is on npm" check. The hook is installed as a
// COPY under ~/.claude/hooks/… that never auto-updates, so the only way a user
// learns about a new release is if we tell them. We do it WITHOUT slowing the
// dialog: the notice shown comes from a cache file, and the cache is refreshed
// in the background (at most once a day) while the user reads the dialog.

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "package.json"); // copied next to the hook at install time
const CACHE = join(HERE, ".update-cache.json");
const REGISTRY = "https://registry.npmjs.org/claude-permission-popup/latest";
const DAY = 24 * 60 * 60 * 1000;

// "0.1.10" > "0.1.9": compare segment by segment, numerically. Pure.
export function isNewer(latest, current) {
  const a = String(latest).split(".").map(Number);
  const b = String(current).split(".").map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

// Pure: the line to append to the dialog (or "" when up to date). Tested.
export function noticeFor(latest, current, lang) {
  if (!latest || !current || !isNewer(latest, current)) return "";
  return "\n\n" + labels(lang).updateAvailable(latest);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

function currentVersion() {
  return readJson(PKG).version || "";
}

// Sync + instant: read the cached "latest" and turn it into a notice. Never
// touches the network, so it can't slow the dialog.
export function updateNotice(lang) {
  try {
    return noticeFor(readJson(CACHE).latest, currentVersion(), lang);
  } catch {
    return "";
  }
}

// Fire-and-forget: if the cache is missing or older than a day, ask npm for the
// latest version and rewrite the cache for NEXT time. Started before the dialog
// so the network call overlaps the seconds the user spends reading it; bounded
// by a short timeout so it can never hang the hook.
export function maybeRefresh() {
  let cache = readJson(CACHE);
  if (cache.lastCheck && Date.now() - cache.lastCheck < DAY) return;
  const write = (latest) => {
    try { writeFileSync(CACHE, JSON.stringify({ lastCheck: Date.now(), latest })); } catch { /* best-effort */ }
  };
  fetch(REGISTRY, { signal: AbortSignal.timeout(4000) })
    .then((r) => r.json())
    .then((j) => write(j.version || cache.latest || ""))
    .catch(() => write(cache.latest || "")); // bump lastCheck so we don't retry-storm
}
