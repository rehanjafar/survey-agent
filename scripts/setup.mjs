import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Install Node.js 24 or later first.");
for (const [packageName, script, args] of [
  ["playwright", "cli.js", ["install", "chromium"]],
  ["typescript", "bin/tsc", ["-p", "tsconfig.build.json"]]
]) {
  execFileSync(
    process.execPath,
    [join(dirname(require.resolve(packageName + "/package.json")), script), ...args],
    { cwd: root, stdio: "inherit" }
  );
}
console.log("Setup complete. Run corepack pnpm start and open http://127.0.0.1:4317");
