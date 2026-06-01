import { execSync, execFileSync } from "node:child_process";

// Claude Code pipes its JSON into the hook's stdin, so `tty` of this process is
// not a real terminal — `$(tty)` fails. Walk the process tree (node → shell →
// claude) reading each ancestor's controlling TTY via `ps` until one resolves.
// Returns "/dev/ttysNNN" or "" if none found.
export function findTty() {
  const sh = (c) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return ""; } };
  let pid = String(process.pid), hops = 0;
  while (pid && pid !== "0" && pid !== "1" && hops < 20) {
    const tty = sh(`ps -o tty= -p ${pid}`).trim();
    if (tty && tty !== "?" && tty !== "??") return "/dev/" + tty;
    pid = sh(`ps -o ppid= -p ${pid}`).trim();
    hops++;
  }
  return "";
}

// AppleScript: find the iTerm2 (then Terminal.app) window/tab whose controlling
// TTY matches, and bring exactly that tab to the front. Matching by TTY — not
// just `activate` — lands on the right tab even with many windows open.
//
// Layer 2 (fallback): when neither iTerm2 nor Terminal owns the tty — i.e. the
// session runs in some other terminal host (VS Code's integrated terminal,
// Warp, Ghostty…) — there is no AppleScript tab model to target, so just bring
// that host app to the front by its bundle id (passed as argv 2). App-level
// only: it can't focus the specific tab, which is the agreed behaviour for
// non-iTerm2/Terminal hosts. An empty bundle id (e.g. a host that exposes none)
// degrades to a silent no-op.
//
// Whether each app is running is checked via System Events (`(name of
// processes) contains ...`), NOT pgrep: iTerm's process name is the full bundle
// path, so `pgrep -x iTerm2` never matched and the whole jump was skipped.
export const JUMP_SCRIPT = `on run argv
  set targetTTY to item 1 of argv
  set fallbackBID to ""
  if (count of argv) > 1 then set fallbackBID to item 2 of argv
  tell application "System Events" to set procs to name of processes
  if procs contains "iTerm2" then
    try
      tell application "iTerm2"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              if tty of s is targetTTY then
                tell w to select
                tell t to select
                activate
                return
              end if
            end repeat
          end repeat
        end repeat
      end tell
    end try
  end if
  if procs contains "Terminal" then
    try
      tell application "Terminal"
        repeat with w in windows
          repeat with t in tabs of w
            if tty of t is targetTTY then
              set selected tab of w to t
              set index of w to 1
              activate
              return
            end if
          end repeat
        end repeat
      end tell
    end try
  end if
  -- Layer 2: no per-tab match above (some other terminal host). Bring its app
  -- to the front by bundle id — app-level only, can't target the tab.
  if fallbackBID is not "" then
    try
      tell application id fallbackBID to activate
    end try
  end if
end run`;

// Bring the terminal window/tab running this Claude session to the front, so the
// user lands back on the native 1/2/3 permission prompt that abstaining
// triggers. Best-effort: any failure (no TTY, app closed, Automation
// permission denied) is swallowed — jumping is a nicety, never load-bearing.
export function jumpToTerminal() {
  const tty = findTty();
  if (!tty) return; // no controlling tty → not in a terminal (e.g. Desktop) → skip
  // __CFBundleIdentifier is set by macOS to the GUI app that launched this
  // process tree, so for a terminal host it's that terminal's bundle id —
  // exactly what Layer 2 needs. Absent (non-GUI launch) → "" → fallback no-ops.
  const bid = process.env.__CFBundleIdentifier || "";
  try {
    execFileSync("/usr/bin/osascript", ["-", tty, bid],
      { input: JUMP_SCRIPT, timeout: 5000, stdio: ["pipe", "ignore", "ignore"] });
  } catch {}
}
