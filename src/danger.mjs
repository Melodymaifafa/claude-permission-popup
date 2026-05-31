// Patterns marking a Bash command as too dangerous to offer "Always allow".
// Matched against the raw command string. Conservative by design: a false
// positive only hides the convenience button — the command can still be
// allowed once. So we prefer over-flagging to under-flagging.
const DANGEROUS_PATTERNS = [
  /\brm\b/, /\brmdir\b/, /\bdd\b/, /\bmkfs\b/, /diskutil\s+erase/i, /\bshred\b/,
  /\bsudo\b/, /\bsu\b/, /\bdoas\b/,
  /\b(?:curl|wget)\b[^|]*\|\s*(?:sh|bash|zsh)\b/,
  /git\s+push\s+(?:[^\n]*\s)?(?:--force|-f)\b/, /git\s+reset\s+--hard\b/, /git\s+clean\s+-[a-z]*f/,
  /\bkill\b/, /\bkillall\b/, /\bpkill\b/, /\bshutdown\b/, /\breboot\b/,
  /chmod\s+-R\b/, /chown\s+-R\b/, /chmod\s+0?777\b/,
  /:\s*\(\s*\)\s*\{/, /\beval\b/,
  // Redirect into a real block/disk device (wipes a disk). Deliberately NOT
  // bare /dev/ — that flagged the harmless `2>/dev/null` / `>/dev/null` idiom
  // and stripped the "Always" button off ordinary safe commands.
  />\s*\/dev\/(?:r?disk|sd[a-z]|nvme|hd[a-z]|vd[a-z]|mmcblk)/i,
];

export function isDangerous(command) {
  if (typeof command !== "string" || command.trim() === "") return false;
  return DANGEROUS_PATTERNS.some((re) => re.test(command));
}
