import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { guidedSetup } from "../../src/cli/setup.js";
import {
  readSettings,
  saveSettings,
  settingsEnvironment,
  settingsSchema
} from "../../src/config/guided-settings.js";
import { loadRuntimeConfig } from "../../src/config/runtime-config.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "survey-setup-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

it("guides first-time setup, retries invalid inputs, connects the account and preserves the phone topic", async () => {
  const path = await directory();
  await writeFile(
    join(path, "notification.json"),
    JSON.stringify({ topicUrl: "https://ntfy.sh/existing-secret" })
  );
  const replies = [
    "toString",
    "branded",
    "",
    "https://bad.example",
    "*.study.test",
    "login.test",
    "120",
    "20",
    "1",
    "yes"
  ];
  const io = {
    question: vi.fn(async () => {
      if (!replies.length) throw new Error("Unexpected prompt");
      return replies.shift()!;
    }),
    print: vi.fn(),
    models: vi
      .fn()
      .mockRejectedValueOnce(new Error("Sign in needed"))
      .mockResolvedValue(["eligible-model"]),
    signIn: vi.fn(async () => {}),
    testNotification: vi.fn(async () => {})
  };
  const result = await guidedSetup(path, io);
  expect(result).toMatchObject({
    platform: "branded",
    model: "eligible-model",
    surveyDomains: ["*.study.test"],
    minimumHourlyReward: 120,
    maxDurationMinutes: 20
  });
  expect(io.signIn).toHaveBeenCalledOnce();
  expect(io.testNotification).toHaveBeenCalledWith("https://ntfy.sh/existing-secret");
  expect(await readSettings(path)).toEqual(result);
  // Windows uses ACLs; POSIX permission bits are only meaningful on Unix.
  if (process.platform !== "win32")
    expect((await stat(join(path, "guided-settings.json"))).mode & 0o777).toBe(0o600);
  const config = loadRuntimeConfig(settingsEnvironment(result, path));
  expect(config.allowedDomains).toEqual(["surveys.gobranded.com"]);
  expect(config.profileDirectory).toBe(join(path, "profiles", "branded"));
  expect(config.llmProvider).toBe("chatgpt_plan");
});

it("does not save runnable settings when account eligibility fails", async () => {
  const path = await directory();
  await expect(
    guidedSetup(path, {
      question: async () => "",
      print: () => {},
      models: async () => [],
      signIn: async () => {},
      testNotification: async () => {}
    })
  ).rejects.toThrow("No eligible ChatGPT models");
  expect(await readSettings(path)).toBeUndefined();
});

it("rejects corrupted settings, unsafe hosts and mismatched start URLs", async () => {
  const path = await directory();
  await writeFile(join(path, "guided-settings.json"), "invalid");
  await expect(readSettings(path)).rejects.toThrow("Run corepack pnpm setup");
  const valid = {
    platform: "prolific",
    startUrl: "https://app.prolific.com/studies",
    model: "model"
  };
  expect(settingsSchema.safeParse({ ...valid, surveyDomains: ["*"] }).success).toBe(false);
  expect(
    settingsSchema.safeParse({ ...valid, startUrl: "https://app.prolific.com.evil.test/studies" })
      .success
  ).toBe(false);
  const settings = settingsSchema.parse(valid);
  await saveSettings(path, settings);
  expect(await readSettings(path)).toEqual(settings);
});
