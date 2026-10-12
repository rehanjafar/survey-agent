import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
export type LoginTarget = "swagbucks" | "chatgpt";
export function chromeProfile(directory: string, target: LoginTarget): string {
  return target === "chatgpt"
    ? join(directory, "chatgpt-chrome-profile")
    : join(directory, "profiles", "swagbucks-chrome");
}
export function chromeLoginArguments(directory: string, target: LoginTarget): string[] {
  return [
    `--user-data-dir=${chromeProfile(directory, target)}`,
    "--new-window",
    target === "chatgpt" ? "https://chatgpt.com/" : "https://www.swagbucks.com/surveys"
  ];
}
export async function chromeExecutable(): Promise<string> {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
            .filter((path): path is string => !!path)
            .map((path) => join(path, "Google", "Chrome", "Application", "chrome.exe"))
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Try the next standard installation. */
    }
  }
  throw new Error(
    "Google Chrome is not installed in a standard location. Install Google Chrome, then reopen this app."
  );
}
/** A normal, user-operated Chrome launch: no automation/debugging flags or login interception. */
export async function openChromeLogin(directory: string, target: LoginTarget): Promise<void> {
  const executable = await chromeExecutable();
  await mkdir(chromeProfile(directory, target), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, chromeLoginArguments(directory, target), {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", () =>
      reject(
        new Error("Could not open Google Chrome. Close the agent's Chrome windows and try again.")
      )
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
