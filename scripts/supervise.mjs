import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
let child;
let stopping = false;
let failures = 0;
let timer;
function launch() {
  const started = Date.now();
  child = spawn(process.execPath, ["dist/cli/main.js"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  // Open once on a deliberate launch, not on every crash restart.
  delete process.env.SURVEY_AGENT_OPEN;
  child.on("error", () => {
    console.error("Could not start Survey Agent. Run setup:local first.");
    stopping = true;
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (stopping || code === 0) return;
    if (Date.now() - started > 60000) failures = 0;
    failures++;
    if (failures > 5) {
      console.error("Stopped after five startup failures. Check the port and settings.");
      process.exitCode = 1;
      return;
    }
    const milliseconds = Math.min(30000, 1000 * 2 ** failures);
    console.error("Restarting Survey Agent in " + milliseconds / 1000 + " seconds.");
    timer = setTimeout(launch, milliseconds);
  });
}
function stop() {
  stopping = true;
  clearTimeout(timer);
  child?.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
launch();
