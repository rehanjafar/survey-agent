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
    startUrl: z.string().url().default("https://www.swagbucks.com/surveys"),
    allowedDomains: z
      .array(z.string().refine(validateDomainRule))
      .min(1)
      .max(100)
      .default(["swagbucks.com", "www.swagbucks.com"]),
    platform: z
      .enum(["generic", "eureka", "prolific", "branded", "swagbucks"])
      .default("swagbucks"),
    surveyHostCatalog: z.boolean().default(true),
    navigationMode: z.enum(["compatible", "strict"]).default("compatible"),
    provider: z.enum(["manual", "chatgpt_plan", "chatgpt_browser"]).default("manual"),
    regularChatFallback: z.boolean().default(false),
    chatgptModel: z.string().default(""),
    authDomains: z.array(z.string().refine(validateDomainRule)).default([]),
    currency: z.enum(["USD", "GBP"]).default("USD"),
    minimumHourlyReward: z.number().nonnegative().finite().default(0),
    maxDurationMinutes: z.number().positive().finite().default(60),
    headless: z.boolean().default(false),
    autoSubmit: z.boolean().default(false),
    autoAcceptConsent: z.boolean().default(false),
    continuousSurveys: z.boolean().default(false),
    offerPollSeconds: z.number().int().min(15).max(3600).default(60),
    minimumConfidence: z.number().min(0.5).max(1).default(0.9),
    maxSteps: z.number().int().min(1).max(500).default(100),
    stepDelayMs: z.number().int().min(250).max(10000).default(800),
    rankBy: z.enum(["reward_per_minute", "reward"]).default("reward_per_minute"),
    restartLastRun: z.boolean().default(false)
  })
  .strict();
export type AppSettings = z.infer<typeof settingsSchema>;
