import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewer, noticeFor } from "../src/update.mjs";

test("isNewer: patch / minor / major bumps", () => {
  assert.equal(isNewer("0.1.6", "0.1.5"), true);
  assert.equal(isNewer("0.2.0", "0.1.9"), true);
  assert.equal(isNewer("1.0.0", "0.9.9"), true);
});

test("isNewer: equal or older → false", () => {
  assert.equal(isNewer("0.1.5", "0.1.5"), false);
  assert.equal(isNewer("0.1.4", "0.1.5"), false);
});

test("isNewer: numeric, not lexicographic (0.1.10 > 0.1.9)", () => {
  assert.equal(isNewer("0.1.10", "0.1.9"), true);
});

test("isNewer: garbage → false (never falsely nags)", () => {
  assert.equal(isNewer("", "0.1.5"), false);
  assert.equal(isNewer("x.y.z", "0.1.5"), false);
});

test("noticeFor: returns a localized line only when newer", () => {
  assert.equal(noticeFor("0.1.5", "0.1.5", "en"), "");
  assert.match(noticeFor("0.1.6", "0.1.5", "en"), /0\.1\.6 available/);
  assert.match(noticeFor("0.1.6", "0.1.5", "zh"), /新版 v0\.1\.6/);
});
