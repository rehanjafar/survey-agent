import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { settingsSchema, saveSettings, type GuidedSettings } from "../config/guided-settings.js";
import { platformPresets, type Platform } from "../platforms/panels/presets.js";
import { validateDomainRule } from "../browser/url-policy.js";
import { NtfyNotifier } from "../notifications/ntfy-notifier.js";

export interface SetupIO {
  question(prompt: string): Promise<string>;
  print(message: string): void;
  models(): Promise<readonly string[]>;
  signIn(): Promise<void>;
  testNotification(topic: string): Promise<void>;
}

export async function guidedSetup(
  directory: string,
  io: SetupIO,
  existing?: GuidedSettings,
  configuredTopic?: string
): Promise<GuidedSettings> {
  const ask = async (
    prompt: string,
    fallback: string,
    valid: (value: string) => boolean
  ): Promise<string> => {
    for (;;) {
      const value = (await io.question(`${prompt} [${fallback}]: `)).trim() || fallback;
      if (valid(value)) return value;
      io.print("Please enter one of the listed choices or a valid value.");
    }
  };
  io.print(
    "Setup saves your choices. No .env editing is needed. Use only studies covered by your authorization."
  );
  const platform = (await ask(
    "Platform: prolific, branded, or eureka",
    existing?.platform ?? "prolific",
    (value) => Object.hasOwn(platformPresets, value)
  )) as Platform;
  const preset = platformPresets[platform];
  const startUrl = await ask(
    "Offer-page address (use the default unless your dashboard differs)",
    existing?.platform === platform ? existing.startUrl : preset.url,
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          preset.hosts.some(
            (host) =>
              host === url.hostname ||
              (host.startsWith("*.") &&
                (url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1))))
          )
        );
      } catch {
        return false;
      }
    }
  );
  const samePlatform = existing?.platform === platform;
  const validDomains = (value: string): boolean =>
    value.toLowerCase() === "none" ||
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .every(validateDomainRule);
  const split = (value: string): string[] =>
    value.toLowerCase() === "none"
      ? []
      : value
          .split(",")
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean);
  io.print(
    "External study and login hosts must be explicitly allowed. Enter hostnames separated by commas; use none if unknown or to clear the list. An unknown redirect will pause for review."
  );
  const surveyDomains = split(
    await ask(
      "Authorized external study hosts",
      samePlatform && existing.surveyDomains.length ? existing.surveyDomains.join(",") : "none",
      validDomains
    )
  );
  const authDomains = split(
    await ask(
      "Additional login-only hosts",
      samePlatform && existing.authDomains.length ? existing.authDomains.join(",") : "none",
      validDomains
    )
  );
  const currency =
    platform === "prolific"
      ? ((await ask(
          "Prolific reward currency to prioritize: USD or GBP",
          existing?.currency ?? "USD",
          (value) => ["USD", "GBP"].includes(value)
        )) as "USD" | "GBP")
      : "USD";
  const unit = platform === "branded" ? "points" : currency;
  const minimumHourlyReward = Number(
    await ask(
      `Minimum advertised ${unit} per hour (0 accepts all)`,
      String(samePlatform ? existing.minimumHourlyReward : 0),
      (value) => Number.isFinite(Number(value)) && Number(value) >= 0
    )
  );
  const maxDurationMinutes = Number(
    await ask(
      "Longest study in minutes",
      String(samePlatform ? existing.maxDurationMinutes : 60),
      (value) => Number.isFinite(Number(value)) && Number(value) > 0
    )
  );
  let models: readonly string[];
  try {
    models = await io.models();
  } catch {
    io.print(
      "Next, sign in to ChatGPT in your browser. This uses your eligible plan; no paid API key or paid fallback."
    );
    await io.signIn();
    models = await io.models();
  }
  if (!models.length)
    throw new Error(
      "No eligible ChatGPT models are available. Check your account access; no paid fallback was enabled."
    );
  io.print(models.map((model, index) => `${index + 1}. ${model}`).join("\n"));
  const defaultModel = existing && models.includes(existing.model) ? existing.model : models[0]!;
  const choice = await ask(
    "Choose a model name or its number",
    defaultModel,
    (value) =>
      models.includes(value) ||
      (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= models.length)
  );
  const model = models.includes(choice) ? choice : models[Number(choice) - 1]!;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const notificationPath = resolve(directory, "notification.json");
  let topic = configuredTopic;
  if (!topic) {
    try {
      topic = (JSON.parse(await readFile(notificationPath, "utf8")) as { topicUrl?: string })
        .topicUrl;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!topic) {
      topic = `https://ntfy.sh/survey-agent-${randomBytes(16).toString("hex")}`;
      await writeFile(notificationPath, JSON.stringify({ topicUrl: topic }), {
        flag: "wx",
        mode: 0o600
      });
    }
  }
  new NtfyNotifier(topic); // Validate before offering to test delivery.
  io.print(
    `Phone alerts: install ntfy, subscribe to ${topic}, and enable notifications. Keep this address private.`
  );
  if (
    (await ask("Send a test phone alert? yes/no", "yes", (value) =>
      ["yes", "no"].includes(value)
    )) === "yes"
  ) {
    await io.testNotification(topic);
    io.print("Test sent. Delivery still needs to be checked on your phone.");
  }
  const settings = settingsSchema.parse({
    platform,
    startUrl,
    surveyDomains,
    authDomains,
    model,
    currency,
    minimumHourlyReward,
    maxDurationMinutes
  });
  await saveSettings(directory, settings);
  io.print(
    `Saved ${preset.name} setup. The start menu lets you log in, run, or change these settings. CAPTCHA alerts require a working phone subscription.`
  );
  return settings;
}
