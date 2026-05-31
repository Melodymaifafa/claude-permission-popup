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
