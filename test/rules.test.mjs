import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRule, detailLine, firstWord, bashPrefix, hostFromUrl, hasShellMeta } from "../src/rules.mjs";

test("firstWord", () => {
  assert.equal(firstWord("git status --short"), "git");
  assert.equal(firstWord("  npm   test "), "npm");
});

test("bashPrefix: program + subcommand, but program-only when 2nd token is a flag", () => {
  assert.equal(bashPrefix("git status --short"), "git status");
  assert.equal(bashPrefix("npm run build"), "npm run");
  assert.equal(bashPrefix("gh pr create -t x"), "gh pr");
  assert.equal(bashPrefix("ls -la"), "ls");
  assert.equal(bashPrefix("date"), "date");
});

test("hostFromUrl", () => {
  assert.equal(hostFromUrl("https://github.com/a/b"), "github.com");
  assert.equal(hostFromUrl("not a url"), "");
});

test("Bash rules", () => {
  assert.equal(buildRule("Bash", { command: "git status --short" }, "exact"), "Bash(git status --short)");
  assert.equal(buildRule("Bash", { command: "git status --short" }, "prefix"), "Bash(git status *)");
});

test("WebFetch rules", () => {
  assert.equal(buildRule("WebFetch", { url: "https://docs.x.com/y" }, "domain"), "WebFetch(domain:docs.x.com)");
  assert.equal(buildRule("WebFetch", { url: "https://docs.x.com/y" }, "all"), "WebFetch");
});

test("file-tool rules use // absolute paths", () => {
  assert.equal(buildRule("Edit", { file_path: "/Users/me/p/src/a.ts" }, "file"), "Edit(//Users/me/p/src/a.ts)");
  assert.equal(buildRule("Edit", { file_path: "/Users/me/p/src/a.ts" }, "dir"), "Edit(//Users/me/p/src/**)");
  assert.equal(buildRule("Read", { file_path: "/x/y.txt" }, "file"), "Read(//x/y.txt)");
});

test("unknown tool → bare name", () => {
  assert.equal(buildRule("WebSearch", {}, "tool"), "WebSearch");
});

test("detailLine truncates to 240", () => {
  assert.equal(detailLine("Bash", { command: "echo hi" }), "echo hi");
  assert.equal(detailLine("Edit", { file_path: "/a/b" }), "/a/b");
  assert.equal(detailLine("WebFetch", { url: "https://x" }), "https://x");
  assert.equal(detailLine("Bash", { command: "x".repeat(300) }).length, 240);
});
