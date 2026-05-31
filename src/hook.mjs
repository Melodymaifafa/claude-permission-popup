import { homedir } from "node:os";
import { join } from "node:path";
import { planDialog } from "./plan.mjs";
import { detailLine } from "./rules.mjs";
import { showDialog } from "./dialog.mjs";
import { readSettings, writeSettings, addAllowRule } from "./settings.mjs";
import { pickLang, labels } from "./i18n.mjs";

const ALLOW = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
const DENY = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } });

const TIMEOUT = 7190; // a touch under the hook's 7200s timeout, so we time out gracefully
const ICON = join(homedir(), ".claude/hooks/claude-permission-popup/claude-icon-rounded.png");
const SETTINGS = join(homedir(), ".claude/settings.json");

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(buf));
  });
}

async function persist(rule) {
  try {
    const s = await readSettings(SETTINGS);
    await writeSettings(SETTINGS, addAllowRule(s, rule));
  } catch {
    // best-effort: a failed persist must never block the allow decision
  }
}

async function main() {
  let input = {};
  try { input = JSON.parse((await readStdin()) || "{}"); } catch { input = {}; }
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};

  const lang = pickLang();
  const L = labels(lang);
  const plan = planDialog(toolName, toolInput);

  let message = toolName ? L.allowTool(toolName) : L.allowAction;
  const detail = detailLine(toolName, toolInput);
  if (detail) message += `\n\n${detail}`;

  const buttons = plan.dangerous ? [L.deny, L.once] : [L.deny, L.once, L.always];
  const def = plan.dangerous ? L.once : L.always;

  const clicked = await showDialog({ title: L.title, message, iconPath: ICON, buttons, defaultButton: def, timeoutSec: TIMEOUT });

  if (clicked === null) return;                 // timeout/dismiss → fall through
  if (clicked === L.deny) return void process.stdout.write(DENY);
  if (clicked === L.once) return void process.stdout.write(ALLOW);
  if (clicked === L.always) {
    if (plan.step2) {
      // Second step (WebFetch only): pick scope.
      const opts = plan.step2.options;
      const labelOf = (o) => (lang === "zh" ? o.label_zh : o.label_en);
      const optBtns = opts.map(labelOf).slice(0, 2);
      const pick = await showDialog({
        title: L.title, message: L.alwaysWhat, iconPath: ICON,
        buttons: [...optBtns, L.cancel], defaultButton: optBtns[0], timeoutSec: TIMEOUT,
      });
      if (pick && pick !== L.cancel) {
        const chosen = opts.find((o) => labelOf(o) === pick);
        if (chosen) await persist(chosen.rule);
      }
    } else if (plan.alwaysRule) {
      // One-click Always: write the scoped rule directly.
      await persist(plan.alwaysRule);
    }
    return void process.stdout.write(ALLOW); // Always = allow now, regardless of persist
  }
}

main().catch(() => process.exit(0));
