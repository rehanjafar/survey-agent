import { z } from "zod";

const environmentSchema = z.object({
  SURVEY_AGENT_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  SURVEY_AGENT_DATA_DIR: z.string().trim().min(1).default("./data"),
  SURVEY_AGENT_ALLOWED_DOMAINS: z.string().default("localhost,127.0.0.1"),
  SURVEY_AGENT_LLM_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional()
});

export type LlmProviderName = "mock" | "openai" | "anthropic";

export interface RuntimeConfig {
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  readonly dataDirectory: string;
  readonly allowedDomains: readonly string[];
  readonly llmProvider: LlmProviderName;
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = environmentSchema.parse(environment);

  if (parsed.SURVEY_AGENT_LLM_PROVIDER === "openai" && !parsed.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when SURVEY_AGENT_LLM_PROVIDER=openai.");
  }

  if (parsed.SURVEY_AGENT_LLM_PROVIDER === "anthropic" && !parsed.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when SURVEY_AGENT_LLM_PROVIDER=anthropic.");
  }

  const allowedDomains = parsed.SURVEY_AGENT_ALLOWED_DOMAINS.split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  if (allowedDomains.length === 0) {
    throw new Error("SURVEY_AGENT_ALLOWED_DOMAINS must contain at least one domain.");
  }

  return {
    logLevel: parsed.SURVEY_AGENT_LOG_LEVEL,
    dataDirectory: parsed.SURVEY_AGENT_DATA_DIR,
    allowedDomains,
    llmProvider: parsed.SURVEY_AGENT_LLM_PROVIDER
  };
}
