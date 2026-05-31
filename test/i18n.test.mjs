import { test } from "node:test";
import assert from "node:assert/strict";
import { langFromOutput } from "../src/i18n.mjs";

test("primary en-US with secondary zh → en (the real bug)", () => {
  assert.equal(langFromOutput('(\n    "en-US",\n    "zh-Hans-US"\n)'), "en");
});

test("primary zh → zh", () => {
  assert.equal(langFromOutput('(\n    "zh-Hans-US",\n    "en-US"\n)'), "zh");
});

test("single en", () => {
  assert.equal(langFromOutput('(\n    "en"\n)'), "en");
});

test("empty / garbage → en", () => {
  assert.equal(langFromOutput(""), "en");
  assert.equal(langFromOutput("nonsense"), "en");
});
