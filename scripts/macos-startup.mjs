import { mkdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
if (process.platform !== "darwin") throw new Error("This installer is for macOS only.");
const root = fileURLToPath(new URL("..", import.meta.url));
const label = "local.survey-agent";
const file = join(homedir(), "Library", "LaunchAgents", label + ".plist");
const domain = "gui/" + process.getuid();
const xml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
if (process.argv[2] === "remove") {
  try {
    execFileSync("launchctl", ["bootout", domain + "/" + label]);
  } catch {
    /* Already unloaded. */
  }
  await unlink(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  console.log("Removed Survey Agent login startup.");
} else if (process.argv[2] === "install") {
  await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  await writeFile(
    file,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(root, "scripts", "supervise.mjs"))}</string></array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/></dict></plist>`,
    { mode: 0o600 }
  );
  execFileSync("launchctl", ["bootstrap", domain, file], { stdio: "inherit" });
  console.log("Installed Survey Agent login startup.");
} else {
  console.log("Usage: node scripts/macos-startup.mjs install|remove");
}
