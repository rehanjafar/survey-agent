import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { NtfyNotifier } from "./ntfy-notifier.js";
const schema = z.object({
  topicUrl: z.string(),
  tested: z.boolean().default(false),
  confirmed: z.boolean().default(false)
});
export type PhoneSetup = z.infer<typeof schema>;
export async function readPhoneSetup(directory: string): Promise<PhoneSetup | undefined> {
  try {
    const setup = schema.parse(
      JSON.parse(await readFile(join(directory, "notification.json"), "utf8"))
    );
    new NtfyNotifier(setup.topicUrl);
    return setup;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      "Phone settings are invalid. Check notification.json in the displayed data folder.",
      { cause: error }
    );
  }
}
export async function savePhoneSetup(directory: string, setup: PhoneSetup): Promise<void> {
  new NtfyNotifier(setup.topicUrl);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "notification.json");
  await writeFile(path + ".tmp", JSON.stringify(schema.parse(setup)), { mode: 0o600 });
  await rename(path + ".tmp", path);
}
export async function ensurePhoneSetup(directory: string): Promise<PhoneSetup> {
  const existing = await readPhoneSetup(directory);
  if (existing) return existing;
  const setup = {
    topicUrl: `https://ntfy.sh/survey-agent-${randomBytes(16).toString("hex")}`,
    tested: false,
    confirmed: false
  };
  await savePhoneSetup(directory, setup);
  return setup;
}
