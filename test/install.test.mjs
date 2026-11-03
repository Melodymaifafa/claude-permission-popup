import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the real installer against a fake HOME in a temp dir, so nothing lands in
// the real ~/.claude. It only copies files: no hook runs, no osascript is called.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const OLD = "40acb23"; // the 0.1.8 release, before context.mjs / message.mjs
// The installer refuses to run off macOS, so off it there is nothing to test.
const macOnly = { skip: platform() !== "darwin" && "the installer runs only on macOS" };

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "cpp-home-"));
  mkdirSync(join(home, ".claude"));
  return home;
}

const destOf = (home) => join(home, ".claude/hooks/claude-permission-popup");

function install(source, home, ...args) {
  return spawnSync(process.execPath, [join(source, "cli.mjs"), "install", ...args], {
    env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 10_000,
  });
}

// A copy of the installable files (no .git), optionally at another version.
function copyRepo(version) {
  const dir = mkdtempSync(join(tmpdir(), "cpp-src-"));
  for (const f of ["cli.mjs", "src", "assets", "package.json"]) cpSync(join(REPO, f), join(dir, f), { recursive: true });
  if (version) setVersion(dir, version);
  return dir;
}

function setVersion(dir, version) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ ...pkg, version }, null, 2) + "\n");
}

// Today's installer with the 0.1.8 src/ and package.json. A 0.1.8 cli.mjs has no
// guard to test. Without that commit (shallow CI clone) the version is faked.
function oldCopy() {
  const tar = spawnSync("git", ["-C", REPO, "archive", "--format=tar", OLD, "src", "package.json"]);
  if (tar.status !== 0) return copyRepo("0.1.8");
  const dir = mkdtempSync(join(tmpdir(), "cpp-old-"));
  assert.equal(spawnSync("tar", ["-x", "-C", dir], { input: tar.stdout }).status, 0);
  for (const f of ["cli.mjs", "assets"]) cpSync(join(REPO, f), join(dir, f), { recursive: true });
  return dir;
}

// sha256 of every installed file, plus settings.json.
function hashes(home) {
  const dest = destOf(home);
  const files = readdirSync(dest).map((f) => join(dest, f)).concat(join(home, ".claude/settings.json"));
  return Object.fromEntries(files.map((f) => [f, createHash("sha256").update(readFileSync(f)).digest("hex")]));
}

const installedVersion = (home) => JSON.parse(readFileSync(join(destOf(home), "package.json"), "utf8")).version;
const installedCommit = (home) => readFileSync(join(destOf(home), ".commit"), "utf8").trim();

const git = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

// A git checkout of the installable files with two commits, A (older) then B, same version.
function gitRepo() {
  const dir = copyRepo();
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "A");
  const a = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "src", "extra.mjs"), "export {};\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "B");
  return { dir, a, b: git(dir, "rev-parse", "HEAD") };
}

test("an older copy does not overwrite a newer install, and leaves every file as it was", macOnly, () => {
  const home = fakeHome();
  assert.equal(install(copyRepo(), home).status, 0);
  const before = hashes(home);
  const r = install(oldCopy(), home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(`^已装的是 ${VERSION}，比要装的 0\\.1\\.8 新，没覆盖$`, "m"));
  assert.deepEqual(hashes(home), before);
});

test("--force overwrites a newer install anyway", macOnly, () => {
  const home = fakeHome();
  assert.equal(install(copyRepo(), home).status, 0);
  const r = install(oldCopy(), home, "--force");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(installedVersion(home), "0.1.8");
});

test("an install from a git checkout stamps its commit; one from a plain copy drops the stamp", macOnly, () => {
  const { dir, b } = gitRepo();
  const home = fakeHome();
  assert.equal(install(dir, home).status, 0);
  assert.equal(installedCommit(home), b);
  // A newer version without a commit (like an npx copy) replaces it, stamp and all.
  assert.equal(install(copyRepo("99.0.0"), home).status, 0);
  assert.equal(existsSync(join(destOf(home), ".commit")), false);
});

test("same version: an older commit or a copy without one cannot replace a newer commit", macOnly, () => {
  const { dir, a, b } = gitRepo();
  const home = fakeHome();
  assert.equal(install(dir, home).status, 0);
  const before = hashes(home);

  git(dir, "checkout", "-q", a);
  const r = install(dir, home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(`^已装的是 ${VERSION} \\(${b.slice(0, 7)}\\)，比要装的 ${VERSION} \\(${a.slice(0, 7)}\\) 新，没覆盖$`, "m"));
  assert.notEqual(install(copyRepo(), home).status, 0);
  assert.deepEqual(hashes(home), before);
});

test("same version: a newer commit replaces an older one, a copy without one, or an unknown one", macOnly, () => {
  const { dir, a, b } = gitRepo();
  const home = fakeHome();
  git(dir, "checkout", "-q", a);
  assert.equal(install(dir, home).status, 0);
  git(dir, "checkout", "-q", b);
  assert.equal(install(dir, home).status, 0);
  assert.equal(installedCommit(home), b);

  const other = fakeHome();
  assert.equal(install(copyRepo(), other).status, 0); // no stamp to compare against
  assert.equal(install(dir, other).status, 0);
  assert.equal(install(dir, other).status, 0);
  assert.equal(installedCommit(other), b);

  writeFileSync(join(destOf(home), ".commit"), "0".repeat(40) + "\n"); // a commit this repo doesn't have
  assert.equal(install(dir, home).status, 0);
  assert.equal(installedCommit(home), b);
});

test("reinstalling the same commit goes ahead", macOnly, () => {
  const { dir, b } = gitRepo();
  const home = fakeHome();
  assert.equal(install(dir, home).status, 0);
  const r = install(dir, home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(installedCommit(home), b);
});
