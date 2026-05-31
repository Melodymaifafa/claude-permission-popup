import { test } from "node:test";
import assert from "node:assert/strict";
import { planDialog } from "../src/plan.mjs";

test("dangerous Bash → no Always (no rule, no step2)", () => {
  const p = planDialog("Bash", { command: "rm -rf build" });
  assert.deepEqual(p, { dangerous: true, alwaysRule: null, step2: null });
});

test("safe Bash → one-click Always writes subcommand-level rule, no step2", () => {
  const p = planDialog("Bash", { command: "git status --short" });
  assert.equal(p.dangerous, false);
  assert.equal(p.alwaysRule, "Bash(git status *)");
  assert.equal(p.step2, null);
});

test("WebFetch → step2 with domain + all-websites, labels carry the host", () => {
  const p = planDialog("WebFetch", { url: "https://docs.x.com/y" });
  assert.equal(p.dangerous, false);
  assert.equal(p.alwaysRule, null);
  assert.deepEqual(p.step2.options.map((o) => o.rule), ["WebFetch(domain:docs.x.com)", "WebFetch"]);
  assert.equal(p.step2.options[0].label_zh, "仅 docs.x.com");
});

test("Edit → one-click Always writes this-file rule, no step2", () => {
  const p = planDialog("Edit", { file_path: "/a/b/c.ts" });
  assert.equal(p.alwaysRule, "Edit(//a/b/c.ts)");
  assert.equal(p.step2, null);
});

test("unknown tool → one-click Always writes bare tool name", () => {
  const p = planDialog("WebSearch", {});
  assert.equal(p.alwaysRule, "WebSearch");
  assert.equal(p.step2, null);
});
