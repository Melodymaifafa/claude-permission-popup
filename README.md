# claude-permission-popup

**English** | [简体中文](./README.zh-CN.md)

Replaces Claude Code's terminal permission prompt with a centered native macOS
dialog, so you can approve or deny without switching back to the terminal.

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

## The dialog

Three buttons:

| Button | What it does |
|--------|--------------|
| **Allow** | Approves this one request. |
| **Deny** | Rejects this one request. |
| **Back** | Dismisses the popup, raises the terminal tab running this session to the front, and hands off to Claude Code's native prompt — that's where "don't ask again" (Always allow) lives, scoped per-program and per-directory far better than a popup could. |

Pressing **Esc**, letting it **time out**, or closing the dialog does the same as
**Back**: it abstains and falls through to the native prompt — never auto-approving.

## Ignored tools

The popup never appears for tools that run their own UI or have no side effects —
it abstains so Claude Code handles them natively: `AskUserQuestion` and
`ExitPlanMode` (force-allowing them would swallow their prompts), plus the Todo
bookkeeping tools.

## Safety

- Only an explicit **Allow** click approves. **Deny** rejects. Everything else
  (Back / Esc / timeout / close) abstains to the native prompt — the popup never
  auto-approves and never persists any rule.
- Install/uninstall edits to `~/.claude/settings.json` take a file lock and back
  the file up to `.bak` first, so concurrent runs can't clobber it.
