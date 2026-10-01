import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("..", import.meta.url));
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error(
    "Please install Node.js 24 or later from https://nodejs.org, then reopen this launcher."
  );
  process.exit(1);
}
try {
  if (!existsSync(join(root, "node_modules", "playwright"))) {
    console.log("First launch: downloading app dependencies. No model calls or API charges.");
    // On Windows npm scripts require cmd; every command argument here is fixed, not user input.
    execFileSync(
      process.platform === "win32" ? "cmd.exe" : "npx",
      process.platform === "win32"
        ? [
            "/d",
            "/s",
            "/c",
            "npx --yes --package=corepack@0.35.0 -- corepack pnpm install --frozen-lockfile"
          ]
        : [
            "--yes",
            "--package=corepack@0.35.0",
            "--",
            "corepack",
            "pnpm",
            "install",
            "--frozen-lockfile"
          ],
      { cwd: root, stdio: "inherit" }
    );
  }
  console.log("Checking Chromium and preparing the dashboard…");
  execFileSync(process.execPath, ["scripts/setup.mjs"], { cwd: root, stdio: "inherit" });
  process.env.SURVEY_AGENT_OPEN = "1";
  await import("./supervise.mjs");
} catch {
  console.error(
    "Setup did not complete. Check your internet connection and the error above, then reopen this launcher."
  );
  process.exitCode = 1;
}
