// Build a permissions.allow rule string from a tool invocation.
// See https://code.claude.com/docs/en/permissions.md for the rule grammar.

export function firstWord(command) {
  return String(command).trim().split(/\s+/)[0] || "";
}

// Words that merely WRAP the real command; the meaningful program comes after.
// Stripping them (plus leading VAR=val assignments) stops "Always allow" from
// recording junk like `LIVE=/x echo` or `env FOO=bar npm`.
const WRAPPERS = new Set([
  "env", "sudo", "doas", "nohup", "time", "exec", "command",
  "builtin", "stdbuf", "nice", "ionice", "setsid", "xargs",
]);

// Programs whose SECOND token is a real subcommand worth keeping in the rule
// (e.g. `git status`, `npm run`). Everything else records just the program
// name, so `node a.mjs` and `node b.mjs` collapse to ONE `Bash(node *)` rule
// instead of two — the main source of "I allowed this many times" bloat.
const SUBCMD_PROGRAMS = new Set([
  "git", "npm", "npx", "pnpm", "yarn", "bun", "deno", "docker", "kubectl",
  "cargo", "go", "gh", "brew", "pip", "pip3", "poetry", "uv", "apt", "apt-get",
  "dnf", "yum", "systemctl", "gcloud", "aws", "terraform", "make", "rustup",
  "conda", "pyenv", "tsc", "deno",
]);

const isAssignment = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);

// True when the command is COMPOUND — pipes, sequencing, background, subshells,
// brace groups, command/process substitution. For these the "first program" is
// not representative (`cat x | grep y` is as much about grep), and shell
// keywords (`for`, `if`) aren't programs at all. The caller stores the FULL
// command instead of guessing a prefix — narrow but never wrong.
export function hasShellMeta(command) {
  return /[|;&(){}`]/.test(command) || command.includes("$(");
}

// Subcommand-level prefix for a SIMPLE (metachar-free) command: peel leading
// VAR=val assignments and wrapper words, then take the program — plus its
// subcommand only if the program is one we know uses subcommands. Falls back to
// the original first word if peeling lands on a flag (don't parse a wrapper's
// own options). hasShellMeta() commands never reach here.
export function bashPrefix(command) {
  const parts = String(command).trim().split(/\s+/).filter(Boolean);
  const original = parts[0] || "";

  while (parts.length && (isAssignment(parts[0]) || WRAPPERS.has(parts[0]))) parts.shift();

  const prog = parts[0] || "";
  if (prog === "" || prog.startsWith("-")) return original; // peeled into options soup
  if (!SUBCMD_PROGRAMS.has(prog)) return prog;              // program-only
  const second = parts[1] || "";
  return second && !second.startsWith("-") ? `${prog} ${second}` : prog;
}

export function hostFromUrl(url) {
  try { return new URL(url).host; } catch { return ""; }
}

function stripLeadingSlash(p) {
  return String(p).replace(/^\/+/, "");
}

// granularity: "exact" | "prefix" | "domain" | "all" | "file" | "dir" | "tool"
export function buildRule(toolName, toolInput = {}, granularity) {
  switch (toolName) {
    case "Bash": {
      const cmd = toolInput.command || "";
      if (granularity !== "prefix") return `Bash(${cmd})`;
      // Compound command → store it whole; only simple commands get a prefix.
      if (hasShellMeta(cmd)) return `Bash(${cmd})`;
      return `Bash(${bashPrefix(cmd)} *)`;
    }
    case "WebFetch":
      return granularity === "all" ? "WebFetch" : `WebFetch(domain:${hostFromUrl(toolInput.url || "")})`;
    case "Read":
    case "Edit":
    case "Write": {
      const p = toolInput.file_path || "";
      if (granularity === "dir") {
        const dir = p.replace(/\/[^/]*$/, "");
        return `${toolName}(//${stripLeadingSlash(dir)}/**)`;
      }
      return `${toolName}(//${stripLeadingSlash(p)})`;
    }
    default:
      return toolName;
  }
}

// Short context line shown in the dialog body. Truncated to 240 chars.
export function detailLine(toolName, toolInput = {}) {
  const raw = toolInput.command ?? toolInput.file_path ?? toolInput.url ?? "";
  return String(raw).slice(0, 240);
}
