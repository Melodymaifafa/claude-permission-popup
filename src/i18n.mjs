import { execSync } from "node:child_process";

// Chinese if the macOS preferred language starts with zh, else English.
export function pickLang() {
  try {
    const out = execSync("defaults read -g AppleLanguages 2>/dev/null", { encoding: "utf8" });
    return /"?zh/i.test(out) ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function labels(lang) {
  if (lang === "zh") {
    return {
      title: "Claude 请求授权",
      deny: "拒绝", once: "允许一次", always: "始终允许", cancel: "取消",
      allowTool: (t) => `是否允许使用 ${t}？`,
      allowAction: "是否允许此操作？",
      alwaysWhat: "以后自动允许网页访问到什么范围？",
    };
  }
  return {
    title: "Claude needs permission",
    deny: "Deny", once: "Allow once", always: "Always", cancel: "Cancel",
    allowTool: (t) => `Allow ${t}?`,
    allowAction: "Allow this action?",
    alwaysWhat: "Always allow web access to:",
  };
}
