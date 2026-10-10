import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { validateDomainRule, isAllowedUrl } from "../browser/url-policy.js";
import { platformPresets } from "../platforms/panels/presets.js";

const domains = z.array(z.string().refine(validateDomainRule, "Use a hostname or *.hostname"));
export const settingsSchema = z
  .object({
    platform: z.enum(["eureka", "prolific", "branded"]),
    startUrl: z.url(),
    authDomains: domains.default([]),
    surveyDomains: domains.default([]),
    model: z.string().min(1),
    currency: z.enum(["USD", "GBP"]).default("USD"),
    minimumHourlyReward: z.number().nonnegative().finite().default(0),
    maxDurationMinutes: z.number().positive().finite().default(60)
  })
  .strict()
  .refine(
    (value) => isAllowedUrl(value.startUrl, new Set(platformPresets[value.platform].hosts)),
    "Start URL must belong to the selected platform"
  );
export type GuidedSettings = z.infer<typeof settingsSchema>;

export async function readSettings(directory: string): Promise<GuidedSettings | undefined> {
  try {
    return settingsSchema.parse(
      JSON.parse(await readFile(resolve(directory, "guided-settings.json"), "utf8"))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Saved setup is invalid. Run corepack pnpm setup to repair it.", {
      cause: error
    });
  }
}
export async function saveSettings(directory: string, settings: GuidedSettings): Promise<void> {
  const validated = settingsSchema.parse(settings);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "guided-settings.json");
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(validated, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

/** Guided choices deliberately override old .env platform/provider values. */
export function settingsEnvironment(
  settings: GuidedSettings,
  directory: string
): NodeJS.ProcessEnv {
  return {
    SURVEY_AGENT_DATA_DIR: directory,
    SURVEY_AGENT_ALLOWED_DOMAINS: platformPresets[settings.platform].hosts.join(","),
    SURVEY_AGENT_AUTH_DOMAINS: settings.authDomains.join(","),
    SURVEY_AGENT_SURVEY_DOMAINS: settings.surveyDomains.join(","),
    SURVEY_AGENT_BROWSER_MODE: "managed_chromium",
    SURVEY_AGENT_PROFILE_DIR: resolve(directory, "profiles", settings.platform),
    SURVEY_AGENT_LLM_PROVIDER: "chatgpt_plan",
    SURVEY_AGENT_CHATGPT_MODEL: settings.model
  };
}
