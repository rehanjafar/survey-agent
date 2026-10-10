import { homedir } from "node:os";
import { join } from "node:path";
import { validateDomainRule } from "../browser/url-policy.js";
import { z } from "zod";

export function defaultDataDirectory(
  platform = process.platform,
  home = homedir(),
  localAppData = process.env.LOCALAPPDATA
): string {
  if (platform === "win32")
    return join(localAppData || join(home, "AppData", "Local"), "SurveyAgent");
  if (platform === "darwin") return join(home, "Library", "Application Support", "SurveyAgent");
  return join(home, ".local", "share", "survey-agent");
}
export const settingsSchema = z
  .object({
    startUrl: z.string().url().default("https://eurekasurveys.com/surveys"),
    allowedDomains: z
      .array(z.string().refine(validateDomainRule))
      .min(1)
      .max(100)
      .default(["eurekasurveys.com", "www.eurekasurveys.com", "localhost", "127.0.0.1"]),
    platform: z.enum(["generic", "eureka", "prolific", "branded"]).default("eureka"),
    navigationMode: z.enum(["compatible", "strict"]).default("compatible"),
    provider: z.enum(["manual", "chatgpt_plan"]).default("manual"),
    chatgptModel: z.string().default(""),
    authDomains: z.array(z.string().refine(validateDomainRule)).default([]),
    currency: z.enum(["USD", "GBP"]).default("USD"),
    minimumHourlyReward: z.number().nonnegative().finite().default(0),
    maxDurationMinutes: z.number().positive().finite().default(60),
    headless: z.boolean().default(false),
    autoSubmit: z.boolean().default(false),
    minimumConfidence: z.number().min(0.5).max(1).default(0.9),
    maxSteps: z.number().int().min(1).max(500).default(100),
    stepDelayMs: z.number().int().min(250).max(10000).default(800),
    rankBy: z.enum(["reward_per_minute", "reward"]).default("reward_per_minute"),
    restartLastRun: z.boolean().default(false)
  })
  .strict();
export type AppSettings = z.infer<typeof settingsSchema>;
