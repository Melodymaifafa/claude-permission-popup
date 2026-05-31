import { isDangerous } from "./danger.mjs";
import { buildRule, hostFromUrl } from "./rules.mjs";

const FILE_TOOLS = new Set(["Read", "Edit", "Write"]);

// Pure: given a tool invocation, decide the dialog plan.
//   dangerous   — true ⇒ caller shows only [Deny][Allow once], no "Always".
//   alwaysRule  — non-null ⇒ "Always" is one-click; write this rule directly.
//   step2       — non-null ⇒ "Always" opens a second dialog to pick scope.
// Exactly one of (dangerous), (alwaysRule), (step2) is the active path.
export function planDialog(toolName, toolInput = {}) {
  if (toolName === "Bash") {
    const cmd = toolInput.command || "";
    if (isDangerous(cmd)) return { dangerous: true, alwaysRule: null, step2: null };
    // Subcommand-level prefix, one click. `git push --force` is a different
    // subcommand and still prompts, so the danger line holds.
    return { dangerous: false, alwaysRule: buildRule("Bash", toolInput, "prefix"), step2: null };
  }
  if (toolName === "WebFetch") {
    const host = hostFromUrl(toolInput.url || "");
    return { dangerous: false, alwaysRule: null, step2: { options: [
      { label_zh: `仅 ${host}`, label_en: `Only ${host}`, rule: buildRule("WebFetch", toolInput, "domain") },
      { label_zh: "所有网站", label_en: "All websites", rule: buildRule("WebFetch", toolInput, "all") },
    ] } };
  }
  if (FILE_TOOLS.has(toolName)) {
    return { dangerous: false, alwaysRule: buildRule(toolName, toolInput, "file"), step2: null };
  }
  return { dangerous: false, alwaysRule: buildRule(toolName, toolInput, "tool"), step2: null };
}
