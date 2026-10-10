import "dotenv/config";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { defaultDataDirectory } from "../config/app-settings.js";
import { createApplication } from "../ui/server.js";

const port = Number(process.env.SURVEY_AGENT_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("SURVEY_AGENT_PORT must be an integer from 1024 to 65535.");
const dataDirectory = process.env.SURVEY_AGENT_DATA_DIR
  ? resolve(process.env.SURVEY_AGENT_DATA_DIR)
  : defaultDataDirectory();
const app = await createApplication(dataDirectory);
try {
  const url = await app.listen(port);
  console.log("Survey Agent — " + url);
  console.log("No-cost mode: profile, memory and manual ChatGPT handoff. No paid model calls.");
  console.log("Local data: " + dataDirectory);
  if (process.env.SURVEY_AGENT_OPEN === "1" || process.argv.includes("--open")) {
    const command =
      process.platform === "win32"
        ? "rundll32.exe"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => console.log("Open this address in your browser: " + url));
    child.unref();
  }
} catch (error) {
  await app.close();
  console.error(
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? "Survey Agent is already running, or port " + port + " is in use."
      : "Could not start the local dashboard."
  );
  process.exitCode = 1;
}
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  await app.close();
  clearTimeout(timeout);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
