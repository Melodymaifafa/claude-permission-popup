# claude-permission-popup

[English](./README.md) | **简体中文**

把 Claude Code 终端里的权限提示,换成屏幕居中的 macOS 原生弹窗——不用切回终端就能允许/拒绝。还带一个按风险分级的"始终允许",写入的是精确的 `permissions.allow` 规则,而不是一刀切放行。

## 环境要求

- **仅 macOS**(用到 `osascript`)。
- **Node 18+**。`npx` 随 Node 一起安装。如果提示 `npx: command not found`,先装 Node:https://nodejs.org

## 安装

```bash
npx claude-permission-popup install
```

或者用这个一行式(会先检查 Node):

```bash
curl -fsSL https://raw.githubusercontent.com/Melodymaifafa/claude-permission-popup/main/install.sh | bash
```

(脚本只检查 Node 并运行安装器,**绝不替你安装 Node**。)

装完重启 Claude Code(或运行 `/hooks`)生效。卸载:

```bash
npx claude-permission-popup uninstall
```

## "始终允许"怎么工作

**始终允许**写入的是**精确**的 `permissions.allow` 规则,绝不一刀切:

| 工具 | "始终允许"记住什么 |
|------|-------------------|
| 安全 Bash | 程序 + 子命令——`git status` → `Bash(git status *)`。一步到位;换个子命令如 `git push --force` 仍会弹窗。 |
| 危险 Bash(`rm`、`sudo`、`dd`、`git push --force` 等) | **没有"始终允许"按钮**——只能"允许一次" |
| WebFetch | 询问:只这个域名,还是所有网站 |
| Read/Edit/Write | 这个文件 |
| 其他工具 | 工具名 |

## 安全

- 只有明确点"允许/始终允许"才放行。超时、Esc 或关闭弹窗,都会回落到 Claude Code 的原生终端提示——**永不自动放行**。
- 任何改动前,`~/.claude/settings.json` 都会先备份成 `.bak`。
