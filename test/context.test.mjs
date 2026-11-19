import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstUserText, scheduledTaskName } from "../src/context.mjs";

const line = (o) => JSON.stringify(o) + "\n";
const user = (content, extra = {}) => ({ type: "user", message: { role: "user", content }, ...extra });
// What Claude Desktop writes before the first user line: queue ops + big attachments.
const preamble = line({ type: "queue-operation", operation: "enqueue", content: "<scheduled-task name=\"not-this\">" })
  + line({ type: "attachment", attachment: { type: "skill_listing", content: "x".repeat(50_000) } });

function transcript(text) {
  const path = join(mkdtempSync(join(tmpdir(), "cpp-")), "t.jsonl");
  writeFileSync(path, text);
  return path;
}

test("firstUserText: skips non-user and meta lines; string or array content", () => {
  assert.equal(firstUserText(preamble + line(user("hi")) + line(user("later"))), "hi");
  assert.equal(firstUserText(line(user("caveat", { isMeta: true })) + line(user("real"))), "real");
  assert.equal(firstUserText(line(user([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]))), "a\nb");
  assert.equal(firstUserText(preamble), null);
});

test("scheduledTaskName: the task name when the first user message is a scheduled-task prompt", () => {
  const prompt = '<scheduled-task name="momo-standalone-rollout" file="/x/SKILL.md">\nThis is an automated run';
  assert.equal(scheduledTaskName(transcript(preamble + line(user(prompt)))), "momo-standalone-rollout");
  assert.equal(scheduledTaskName(transcript(line(user([{ type: "text", text: prompt }])))), "momo-standalone-rollout");
  // a run without a project folder: Desktop puts system reminders in front of the tag
  const reminder = "<system-reminder>\nThe user started this session without choosing a project folder…\n</system-reminder>\n\n";
  assert.equal(scheduledTaskName(transcript(preamble + line(user(reminder + reminder + prompt)))), "momo-standalone-rollout");
});

test("scheduledTaskName: null for a normal session, even if a later message mentions a task", () => {
  const path = transcript(preamble + line(user("fix the popup")) + line(user('<scheduled-task name="x">')));
  assert.equal(scheduledTaskName(path), null);
  const quoted = '<system-reminder>\nhi\n</system-reminder>\nwhy did <scheduled-task name="x"> pop up?';
  assert.equal(scheduledTaskName(transcript(line(user(quoted)))), null);
});

test("scheduledTaskName: null for a missing, empty or unreadable transcript", () => {
  assert.equal(scheduledTaskName(undefined), null);
  assert.equal(scheduledTaskName(""), null);
  assert.equal(scheduledTaskName("/nonexistent/t.jsonl"), null);
  assert.equal(scheduledTaskName(transcript("")), null);
  assert.equal(scheduledTaskName(transcript("{not json\n")), null);
});
