import { execFile } from "node:child_process";

// Show a modal dialog with up to 3 buttons. Resolves to the clicked button
// label, or null on timeout / dismiss (Esc) / error / cancel-button. The
// AppleScript reads its script from stdin (osascript -) and takes
// title/message/icon/default/cancel/buttons as argv, so button labels (any
// language) never need escaping into the script.
// cancelButton (optional): designating a button as the cancel button makes Esc
// trigger it too, and clicking it raises an error → resolves to null. Pass ""
// to omit (then Esc does nothing, per macOS).
export function showDialog({ title, message, iconPath, buttons, defaultButton, cancelButton = "", timeoutSec }) {
  const cancelClause = cancelButton ? " cancel button cb" : "";
  const script = `on run argv
  set t to item 1 of argv
  set m to item 2 of argv
  set iconPath to item 3 of argv
  set db to item 4 of argv
  set cb to item 5 of argv
  set btns to items 6 thru -1 of argv
  try
    try
      set r to display dialog m with title t buttons btns default button db${cancelClause} with icon (POSIX file iconPath) giving up after ${timeoutSec}
    on error
      set r to display dialog m with title t buttons btns default button db${cancelClause} giving up after ${timeoutSec}
    end try
    if (gave up of r) then return "__GAVEUP__"
    return button returned of r
  on error
    return "__ERROR__"
  end try
end run`;
  const args = ["-", title, message, iconPath, defaultButton, cancelButton, ...buttons];
  return new Promise((resolve) => {
    const child = execFile(
      "/usr/bin/osascript",
      args,
      { timeout: (timeoutSec + 10) * 1000, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) return resolve(null);
        const out = String(stdout).trim();
        if (out === "" || out === "__GAVEUP__" || out === "__ERROR__") return resolve(null);
        resolve(out);
      },
    );
    child.stdin.end(script);
  });
}
