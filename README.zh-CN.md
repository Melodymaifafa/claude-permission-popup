# claude-permission-popup

[English](./README.md) | **简体中文**

把 Claude Code 终端里的权限提示,换成屏幕居中的 macOS 原生弹窗——不用切回终端就能允许或拒绝。

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

## 弹窗

三个按钮:

| 按钮 | 作用 |
|------|------|
| **允许** | 放行这一次请求。 |
| **拒绝** | 拒绝这一次请求。 |
| **返回** | 关掉弹窗,交回 Claude Code 的原生终端提示——"始终允许"(don't ask again)在那里,按程序、按目录的分级远比弹窗精确。 |

按 **Esc**、**超时**、或直接关掉弹窗,效果同**返回**:回落到原生提示,**永不自动放行**。

## 被忽略的工具

弹窗对"自带 UI"或"无副作用"的工具不出现——直接放行给 Claude Code 原生处理:`AskUserQuestion` 和 `ExitPlanMode`(强行允许会把它们的提示吞掉),以及 Todo 记录类工具。

## 安全

- 只有明确点**允许**才放行,**拒绝**才驳回。其余(返回 / Esc / 超时 / 关闭)一律回落到原生提示——弹窗**从不自动放行,也从不写入任何规则**。
- 安装 / 卸载改写 `~/.claude/settings.json` 时会加文件锁、先备份成 `.bak`,并发运行也不会互相覆盖。
