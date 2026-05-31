# claude-permission-popup

**English** | [简体中文](./README.zh-CN.md)

Replaces Claude Code's terminal permission prompt with a centered native macOS dialog,
so you can approve/deny without switching back to the terminal — with a risk-tiered
"Always allow" that writes precise `permissions.allow` rules.

## Requirements

- **macOS only** (uses `osascript`).
- **Node 18+.** `npx` ships with Node. If `npx` is "command not found", install Node first: https://nodejs.org

## Install

```bash
npx claude-permission-popup install
```

Or, if you prefer a one-liner that checks for Node first:

```bash
curl -fsSL https://raw.githubusercontent.com/Melodymaifafa/claude-permission-popup/main/install.sh | bash
```

(The script only checks for Node and runs the installer — it never installs Node for you.)

Restart Claude Code (or run `/hooks`) to activate. Uninstall:

```bash
npx claude-permission-popup uninstall
```

## How "Always allow" works

**Always** writes a *scoped* `permissions.allow` rule, never a blanket one:

| Tool | What "Always" remembers |
|------|-------------------------|
| Safe Bash | program (+ subcommand for `git`/`npm`/`docker`/…) — `git status -s` → `Bash(git status *)`, `node a.mjs` → `Bash(node *)`. Leading `VAR=…` and wrappers (`env`, `nohup`, `time`, …) are stripped. |
| Compound Bash (pipes, `&&`, `;`, subshells, `$(…)`) | the full command, verbatim — no fragile prefix guessing |
| Dangerous Bash (`rm`, `sudo`, `dd`, `git push --force`, writing to `/dev/sda`, …) | **no Always button** — allow once only |
| WebFetch | asks: just this domain, or all websites |
| Read/Edit/Write | this file |
| Other tools | the tool name |

## Ignored tools

The popup never appears for tools that run their own UI or have no side effects —
it abstains so Claude Code handles them natively: `AskUserQuestion` and
`ExitPlanMode` (force-allowing them would swallow their prompts), plus the Todo
bookkeeping tools.

## Safety

- Only an explicit Allow/Always click allows. Timeout, Esc, or closing the dialog
  abstains — it falls through to Claude Code's normal terminal prompt, never auto-approving.
- Writes to `~/.claude/settings.json` take a file lock, so several Claude sessions
  clicking "Always" at once can't clobber each other's rules. The file is copied to
  `.bak` before any change.
