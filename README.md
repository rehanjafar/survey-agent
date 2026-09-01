# Survey Agent

A local, auditable foundation for a browser-based survey agent operating only on authorized survey environments. The project will use deterministic browser actions, compact structured LLM decisions, profile and answer memory, SQLite storage, and human-review stop states.

## Current milestone

This first milestone provides only a runnable TypeScript foundation: project configuration, environment validation, a small CLI health check, and automated tests. It deliberately does **not** launch a browser, access a survey site, persist data, or call an LLM.

## Prerequisites

- Node.js 24 or newer
- Corepack (bundled with supported Node.js releases) to provide pnpm 11

## Setup

```sh
corepack pnpm install
cp .env.example .env
corepack pnpm check
corepack pnpm dev
```

`SURVEY_AGENT_ALLOWED_DOMAINS` defaults to local addresses in `.env.example`. Future browser milestones will enforce this allowlist.

## Commands

| Command                      | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| `corepack pnpm dev`          | Run the minimal CLI health/configuration report. |
| `corepack pnpm test`         | Run Vitest tests.                                |
| `corepack pnpm lint`         | Run ESLint.                                      |
| `corepack pnpm typecheck`    | Run strict TypeScript validation.                |
| `corepack pnpm format:check` | Verify Prettier formatting.                      |
| `corepack pnpm check`        | Run all local quality checks.                    |

## Layout

- `src/config` — environment and runtime configuration
- `src/cli` — local command-line entrypoint
- `src/browser`, `src/extraction`, `src/normalization`, `src/storage`, `src/providers`, `src/decision`, `src/validation`, `src/execution`, `src/logging`, `src/domain` — reserved module boundaries for later milestones
- `tests` — unit, integration, and end-to-end tests; all future browser tests use a local mock survey app

## Safety

Use only authorized, allowlisted environments. The intended agent will stop rather than attempt CAPTCHA solving, authentication bypassing, or unsupported/ambiguous interactions. See [AGENTS.md](AGENTS.md) for development rules.
