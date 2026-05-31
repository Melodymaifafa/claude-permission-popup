import { homedir } from "node:os";
import { join } from "node:path";
import { planDialog } from "./plan.mjs";
import { detailLine } from "./rules.mjs";
import { showDialog } from "./dialog.mjs";
import { updateSettings, addAllowRule } from "./settings.mjs";
import { pickLang, labels } from "./i18n.mjs";

const ALLOW = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
const DENY = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } });

// Tools the popup must stay OUT of: it abstains (exit 0, no stdout) so Claude
// Code runs its native flow for them. Two reasons a tool belongs here:
//   1. It renders its OWN interactive UI (a choice list, a plan-approval
//      prompt). Force-allowing such a tool from a hook resolves the permission
//      as "granted" but SWALLOWS that UI. Abstaining — neither allow nor deny —
//      is the only output that lets the native UI render. These are the only
//      two built-in interactive tools: AskUserQuestion and ExitPlanMode.
//   2. It's no-side-effect bookkeeping (the Todo tools) — a popup for it is
//      pure noise, so pass it straight through.
const IGNORE = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite", "TodoRead"]);

const TIMEOUT = 120; // dialog auto-dismisses after 2 min; stays under the hook's settings.json timeout
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
    // updateSettings does the read-modify-write under a file lock, so two
    // sessions clicking "Always" at once can't clobber each other's rules.
    await updateSettings(SETTINGS, (s) => addAllowRule(s, rule));
  } catch {
    // best-effort: a failed persist must never block the allow decision
  }
}

async function main() {
  let input = {};
  try { input = JSON.parse((await readStdin()) || "{}"); } catch { input = {}; }
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};

  if (IGNORE.has(toolName)) return; // abstain → native flow renders AskUserQuestion's choices

  const lang = pickLang();
  const L = labels(lang);
  const plan = planDialog(toolName, toolInput);

  let message = toolName ? L.allowTool(toolName) : L.allowAction;
  const detail = detailLine(toolName, toolInput);
  if (detail) message += `\n\n${detail}`;

  const buttons = plan.dangerous ? [L.deny, L.once] : [L.deny, L.once, L.always];
  const def = plan.dangerous ? L.once : L.always;

  const clicked = await showDialog({ title: L.title, message, iconPath: ICON, buttons, defaultButton: def, timeoutSec: TIMEOUT });

  if (clicked === null) return; // timeout/dismiss → abstain → native terminal prompt still gates it
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
