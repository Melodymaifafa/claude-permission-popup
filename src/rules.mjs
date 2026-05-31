// Build a permissions.allow rule string from a tool invocation.
// See https://code.claude.com/docs/en/permissions.md for the rule grammar.

export function firstWord(command) {
  return String(command).trim().split(/\s+/)[0] || "";
}

// Subcommand-level prefix: program + its subcommand (e.g. "git status").
// If the second token is a flag (starts with "-"), fall back to just the
// program. Used so "Always allow" stays narrow — `git push --force` is a
// different subcommand and still prompts.
export function bashPrefix(command) {
  const parts = String(command).trim().split(/\s+/);
  const prog = parts[0] || "";
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
      return granularity === "prefix" ? `Bash(${bashPrefix(cmd)} *)` : `Bash(${cmd})`;
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
