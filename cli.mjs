#!/usr/bin/env node
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { addHook, removeHook, updateSettings, hookCommand } from "./src/settings.mjs";
import { isNewer } from "./src/update.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = join(homedir(), ".claude/hooks/claude-permission-popup");
const SETTINGS = join(homedir(), ".claude/settings.json");

const readText = (path) => { try { return readFileSync(path, "utf8").trim(); } catch { return ""; } };
const versionIn = (dir) => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version || ""; } catch { return ""; } };
const label = (version, commit) => (commit ? `${version} (${commit.slice(0, 7)})` : version);

// git in the source checkout; null when it fails (no git, unknown commit, non-zero exit).
function git(...args) {
  try { return execFileSync("git", ["-C", HERE, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

// Why the copy in HERE must not replace the one in DEST, or "" when it may.
// Versions decide; equal versions fall back to the commit stamped at install time.
function refusal(version, commit) {
  const destVersion = versionIn(DEST), destCommit = readText(join(DEST, ".commit"));
  const older = isNewer(destVersion, version) || (
    destVersion === version && destCommit && destCommit !== commit &&
    // Ours has no commit, or is an ancestor of the installed one. An installed
    // commit this repo doesn't know makes git fail, so that install goes ahead.
    (!commit || git("merge-base", "--is-ancestor", commit, destCommit) !== null));
  return older ? `已装的是 ${label(destVersion, destCommit)}，比要装的 ${label(version, commit)} 新，没覆盖` : "";
}

async function install() {
  const force = process.argv.includes("--force");
  if (platform() !== "darwin") {
    console.error("claude-permission-popup is macOS-only (it uses osascript). Aborting.");
    process.exit(1);
  }
  // No ~/.claude usually means Claude Code isn't installed — registering a hook
  // there would be a no-op. Warn and abort unless the user insists with --force.
  if (!existsSync(join(homedir(), ".claude")) && !force) {
    console.error("No ~/.claude directory found — is Claude Code installed and run at least once?");
    console.error("If you're sure, create it anyway with:");
    console.error("  npx claude-permission-popup install --force");
    process.exit(1);
  }
  // Only a git checkout has a commit. npx copies have no .git, and probing them
  // would trip macOS's "install the developer tools" prompt where git is missing.
  const commit = existsSync(join(HERE, ".git")) ? git("rev-parse", "HEAD") : null;
  const why = force ? "" : refusal(versionIn(HERE), commit);
  if (why) {
    console.error(why);
    console.error("要覆盖就加 --force");
    process.exit(1);
  }
  await mkdir(DEST, { recursive: true });
  await cp(join(HERE, "src"), DEST, { recursive: true });
  await cp(join(HERE, "assets", "claude-icon-rounded.png"), join(DEST, "claude-icon-rounded.png"));
  // Ship package.json too: the hook reads its own version from it to compare
  // against the latest on npm (the update-available notice in the dialog).
  await cp(join(HERE, "package.json"), join(DEST, "package.json"));
  // Stamp the commit so a later install of the same version can tell old from new.
  // Without one, drop any old stamp: it would describe files we just replaced.
  if (commit) await writeFile(join(DEST, ".commit"), commit + "\n");
  else await rm(join(DEST, ".commit"), { force: true });
  // process.execPath = the absolute node binary running this installer — the
  // right one to bake into the hook command so it runs regardless of PATH.
  const command = hookCommand(process.execPath, homedir());
  await updateSettings(SETTINGS, (s) => addHook(s, command));
  console.log("✓ Installed to", DEST);
  console.log("✓ Registered PermissionRequest hook in", SETTINGS, "(backup at .bak)");
  console.log("Restart Claude Code (or run /hooks) to activate.");
}

async function uninstall() {
  await updateSettings(SETTINGS, removeHook);
  console.log("✓ Removed the hook from", SETTINGS, "(backup at .bak)");
  console.log("Files remain in", DEST, "— delete that folder manually to fully remove.");
}

const cmd = process.argv[2];
if (cmd === "install") await install();
else if (cmd === "uninstall") await uninstall();
else {
  console.log("Usage: npx claude-permission-popup <install|uninstall>");
  process.exit(1);
}
