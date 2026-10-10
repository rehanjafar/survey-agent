# Survey Agent

A local, auditable foundation for a browser-based survey agent operating only on authorized survey environments. The project will use deterministic browser actions, compact structured LLM decisions, profile and answer memory, SQLite storage, and human-review stop states.

## Current milestone

The reusable core includes an allowlisted Playwright Chromium driver, generic active-question extraction, normalized question fingerprints, SQLite profile/answer memory, cache-first answer decisions, structured OpenAI/Anthropic provider adapters, and a structured-action executor. Browser integration tests remain local-only.

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

`SURVEY_AGENT_ALLOWED_DOMAINS` defaults to local addresses in `.env.example`. Browser navigation enforces the configured rules, including redirects and popups.

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

## Eureka login and external surveys

The CLI now supports an interactive, one-question Eureka handoff. It opens the highest
reward offer, follows an authorized popup or redirect, and asks for a structured
answer through your regular ChatGPT chat. It does not yet run surveys unattended
or automatically submit/advance pages.

1. Set `SURVEY_AGENT_ALLOWED_DOMAINS` to your authorized Eureka hosts (for example
   `eurekasurveys.com,*.eurekasurveys.com`). Add the actual identity-provider hosts
   needed by your login to `SURVEY_AGENT_AUTH_DOMAINS`.
2. Add authorized third-party survey hosts and routing intermediaries to
   `SURVEY_AGENT_SURVEY_DOMAINS`. Exact hosts are preferred; `*.example.test`
   explicitly permits the apex and all its subdomains. Redirects never add trust.
   Unknown destinations are blocked before navigation and require configuration
   review. Host matching rejects suffix lookalikes, userinfo URLs, non-HTTP(S)
   protocols, URLs used as rules, and global wildcards. Rules apply to navigation,
   including frame navigation, rather than third-party image/script requests.
3. Set `SURVEY_AGENT_LLM_PROVIDER=manual_chatgpt` and run:

   ```sh
   corepack pnpm dev login https://eurekasurveys.com/surveys
   corepack pnpm dev eureka https://eurekasurveys.com/surveys
   ```

   Replace the URL with your actual authorized offer-page URL. Installed Google
   Chrome is required for these managed CLI commands. Log in yourself, including
   any CAPTCHA or verification. The dedicated profile under `data/chrome-profile`
   retains cookies and site storage across runs. Close other agent instances using
   the same profile. If login expires, repeat `login`; do not copy credentials into
   configuration or attempt to automate verification.

Separate auth scope means the browser can navigate to a configured login provider,
while the Eureka adapter refuses to treat that provider as a survey host. Survey
hosts can have branded/private domains, so a static vendor list cannot be complete.
For authorized SurveyMonkey environments, its [official allowlist](https://help.surveymonkey.com/en/surveymonkey/account/allow-list/)
documents `*.surveymonkey.com`, `*.surveymonkey.net`, `*.surveymk.com`, and
`*.research.net`. Alchemer documents default and branded links under
`*.alchemer.com` in its [link guide](https://help.alchemer.com/help/share-survey-via-link),
with regional/private-domain examples in its [private-domain guide](https://help.alchemer.com/help/setting-up-a-link-to-your-survey-using-your-private-domain).
These are candidate rules to enable only for your authorized destinations, not
an assertion that Eureka uses those vendors. Add each actual custom host separately.
No vendor hosts are enabled by default.

### Reusing an already logged-in Chrome session

Use `SURVEY_AGENT_BROWSER_MODE=attached_chrome` with a loopback-only CDP endpoint,
such as `http://127.0.0.1:9222`. Start a separate Chrome instance with remote
debugging enabled and a dedicated user-data directory, sign in manually, and
leave a tab open at the exact start URL. The agent selects by origin and path
rather than using an arbitrary first tab. It disconnects without closing existing
Chrome tabs. Navigation rules apply to the entire attached context while the agent is connected; use a dedicated Chrome instance without unrelated tabs. Ordinary Chrome sessions without remote debugging cannot be attached.
Persistent managed mode is generally easier because it launches the dedicated
profile automatically. No stealth flags, CAPTCHA solvers, or auth bypass are used.

## ChatGPT handoff and costs

`manual_chatgpt` makes zero API requests. Review the displayed question and relevant
profile facts, paste them into a normal ChatGPT chat, and paste the single-line JSON
reply back into the terminal. The agent validates the reply against current options,
requires sufficient confidence, rechecks page state, and asks before applying it.
Empty or invalid replies stop for human review. Authentication, CAPTCHA, blocked
hosts, and unsupported questions remain stop states. Only normalized question data
and relevant facts are shared; browser cookies, selectors, complete pages, and
credentials are excluded. You decide which personal facts to share.

The library's `AnswerDecisionEngine` accepts an optional fourth `fallbackProvider`
argument. A `ManualChatGPTProvider` there receives low-confidence or missing-answer
results from the primary provider. For zero API usage, use it as the primary provider
(as the CLI does); using a paid primary still incurs that primary request. Confident
cached answers remain first. Invalid/unsupported answers are no longer cached.
Normal ChatGPT account usage limits still apply. The bridge is human-mediated;
it does not scrape ChatGPT or promise a fully autonomous free model endpoint.
For an integration initiated from ChatGPT itself, [GPT Actions](https://developers.openai.com/api/docs/actions/introduction)
are a separate supported architecture, not implemented by this CLI.

Run `corepack pnpm check` to verify the code. All browser tests use local mock pages,
including persistent session reuse, external popups, and forbidden redirect requests.
Keep profile directories, SQLite databases, and personal data out of Git (the default
`data/` directory is ignored).
