import { execSync } from "node:child_process";

// Pure: pick zh/en from the PRIMARY (first) language in the AppleLanguages
// list. Only the first entry matters — a secondary zh must NOT flip an
// en-primary user (the list is ordered, e.g. ("en-US", "zh-Hans-US")).
export function langFromOutput(out) {
  const primary = (String(out).match(/"([^"]+)"/) || [, ""])[1].toLowerCase();
  return primary.startsWith("zh") ? "zh" : "en";
}

export function pickLang() {
  try {
    return langFromOutput(execSync("defaults read -g AppleLanguages 2>/dev/null", { encoding: "utf8" }));
  } catch {
    return "en";
  }
}

export function labels(lang) {
  if (lang === "zh") {
    return {
      title: "Claude 请求授权",
      back: "返回", deny: "拒绝", once: "允许",
      allowTool: (t) => `是否允许使用 ${t}？`,
      allowMcp: (server, tool) => `是否允许使用 ${server} 的 ${tool}？`,
      knownTools: {
        Bash: "要运行一条命令，允许吗？",
        Edit: "要改一个文件，允许吗？",
        Write: "要新建或覆盖一个文件，允许吗？",
        start_session: "要开一个新会话，允许吗？",
        update_scheduled_task: "要改定时任务，允许吗？",
        request_access: "要操作这台电脑上的应用，允许吗？",
      },
      allowAction: "是否允许此操作？",
      fromTask: (n) => `来自定时任务：${n}`,
      fromFolder: (f) => `来自文件夹：${f}`,
      moreChars: (n) => `…后面还有 ${n} 字`,
      moreFields: (n) => `…另有 ${n} 项参数`,
      toolName: (t) => `工具名：${t}`,
      updateAvailable: (v) => `🆕 新版 v${v} 可用 · 重装更新：npx claude-permission-popup@latest install`,
    };
  }
  return {
    title: "Claude needs permission",
    back: "Back", deny: "Deny", once: "Allow",
    allowTool: (t) => `Allow ${t}?`,
    allowMcp: (server, tool) => `Allow ${tool} from ${server}?`,
    knownTools: {
      Bash: "Allow Claude to run a command?",
      Edit: "Allow Claude to edit a file?",
      Write: "Allow Claude to create or overwrite a file?",
      start_session: "Allow Claude to start a new session?",
      update_scheduled_task: "Allow Claude to change a scheduled task?",
      request_access: "Allow Claude to control apps on this computer?",
    },
    allowAction: "Allow this action?",
    fromTask: (n) => `From scheduled task: ${n}`,
    fromFolder: (f) => `From folder: ${f}`,
    moreChars: (n) => `…${n} more chars`,
    moreFields: (n) => `…${n} more fields`,
    toolName: (t) => `Tool: ${t}`,
    updateAvailable: (v) => `🆕 v${v} available · update: npx claude-permission-popup@latest install`,
  };
}
