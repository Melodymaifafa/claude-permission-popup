import { test } from "node:test";
import assert from "node:assert/strict";
import { JUMP_SCRIPT, findTty } from "../src/jump.mjs";

// Layer 1: iTerm2 / Terminal matched precisely by controlling TTY → focus that
// exact tab. This is the best-experience path and must stay intact.
test("Layer 1 — matches iTerm2 and Terminal tabs by tty", () => {
  assert.match(JUMP_SCRIPT, /tell application "iTerm2"/);
  assert.match(JUMP_SCRIPT, /tell application "Terminal"/);
  assert.match(JUMP_SCRIPT, /tty of s is targetTTY/, "iTerm2 matches session tty");
  assert.match(JUMP_SCRIPT, /tty of t is targetTTY/, "Terminal matches tab tty");
});

// Layer 2: no per-tab match (some other terminal host — VS Code, Warp, Ghostty…)
// → bring that host app to the front by bundle id. App-level only, no tab focus.
test("Layer 2 — falls back to activating the host app by bundle id", () => {
  assert.match(JUMP_SCRIPT, /tell application id fallbackBID to activate/);
});

test("Layer 2 — fallback fires only AFTER the precise-match blocks", () => {
  const iterm = JUMP_SCRIPT.indexOf('tell application "iTerm2"');
  const term = JUMP_SCRIPT.indexOf('tell application "Terminal"');
  const fb = JUMP_SCRIPT.indexOf("tell application id fallbackBID");
  assert.ok(iterm >= 0 && term >= 0 && fb >= 0, "all three branches present");
  assert.ok(fb > iterm && fb > term, "fallback must come after both precise blocks");
});

test("Layer 2 — guards against an empty bundle id", () => {
  // fallbackBID defaults to "" and the activate is gated on it being non-empty,
  // so a host that exposes no bundle id degrades to a silent no-op (e.g. Desktop).
  assert.match(JUMP_SCRIPT, /set fallbackBID to ""/);
  assert.match(JUMP_SCRIPT, /if fallbackBID is not ""/);
});

test("findTty returns a string — \"\" or a /dev path", () => {
  const t = findTty();
  assert.equal(typeof t, "string");
  if (t) assert.match(t, /^\/dev\//);
});
