# Survey Agent

A local Windows/macOS survey workspace with a browser dashboard, persistent Chromium session, SQLite profile and answer memory, and a review/resume workflow.

**The dashboard makes no paid model calls.** It automatically reuses established profile facts and confirmed mappings. New questions can be answered in the UI or copied into your normal ChatGPT conversation. ChatGPT handoff is manual; this project does not promise unlimited account usage or automate the ChatGPT website.

## Install on Windows or macOS

### Easiest way to start

Install Node.js 24 or later, download/extract this branch, then double-click **Start-Windows.cmd** or **Start-macOS.command** in the project folder. The launcher installs missing dependencies, checks Chromium, builds the app and opens the dashboard. Keep its window open. On Mac, if Finder blocks the command file, run `sh Start-macOS.command` from that folder in Terminal.

**Do not open `public/index.html` as the app.** The running dashboard is at **http://127.0.0.1:4317/** (or the custom port shown by the launcher). Start with **1. Try practice**, answer the review cards, then add your profile and connect a website. Setup requires internet access for package/browser downloads but makes no model calls.

### Manual installation

Install **Node.js 24 LTS** from [nodejs.org](https://nodejs.org/). Download this repository as a ZIP and extract it, or clone it with Git. Open a terminal inside the project folder:

```sh
npm install --global corepack
corepack pnpm install --frozen-lockfile
corepack pnpm setup:local
corepack pnpm start
```

If Corepack is already installed, omit its installation command. On Windows use PowerShell or Command Prompt. These commands download dependencies and Chromium; setup does not contact a model or open a real survey. Do not copy `node_modules` or browser binaries between operating systems: install them on each laptop.

If installing Corepack reports an existing `yarn.cmd` or requires administrator access, leave your existing tools alone and use this isolated alternative:

```sh
npx --yes --package=corepack@0.35.0 -- corepack pnpm install --frozen-lockfile
npx --yes --package=corepack@0.35.0 -- corepack pnpm setup:local
node scripts/supervise.mjs
```

This uses the same pinned package manager without installing global command shims. The Windows and macOS launchers also run directly through Node after setup.

Open **http://127.0.0.1:4317**. The dashboard is accessible only from that computer. To use a different port, set `SURVEY_AGENT_PORT` in a local `.env` file before starting. Avoid running multiple app processes on the same data directory.

Once installed, start with `Start-Windows.cmd`, `Start-macOS.command`, or:

```sh
corepack pnpm start:permanent
```

On macOS, if Finder will not launch the downloaded command file, run `sh Start-macOS.command` in Terminal. Keep the terminal open, or configure login startup below.

## First run

1. Open **My profile** and add your actual country, age, household size or preferences. Only confirmed, non-temporary facts can drive automatic answers.
2. Click **Try local practice**. It runs an Eureka-like offer page and radio, numeric, checkbox, dropdown, text and matrix questions on a local mock server.
3. Answer unfamiliar questions in the review panel. Enable **Reuse this answer** only for information appropriate for future matching questions.
4. Configure your survey URL and exact allowed domains under **Connections & setup**.
5. Start the survey, sign in manually in the dedicated browser if needed, and click **Resume**.
6. Final submission asks for confirmation by default. Automatic submission is an explicit setting.

A run is bounded by a maximum action count. Completion stops that run. Pause leaves its browser available for inspection; Stop closes the managed browser. CAPTCHA, authentication, ambiguity, unfamiliar widgets, profile conflicts, unchanged pages and unsupported frames stop progress for review.

## Eureka support

The adapter discovers recognizable offers and ranks them by displayed reward per minute (or absolute reward). Offers with unknown duration rank below known-duration offers in the per-minute mode. Displayed amounts are not guaranteed earnings.

Question handling supports native labelled radio buttons, checkboxes, single-select dropdowns, text/numeric inputs, radio scales, labelled radio matrices, and conditional fields exposed after an answer. It re-extracts the page after actions and checks browser control values.

Eureka's live website and third-party survey providers have **not** been validated by this project. The same generic question extractor runs on approved third-party domains; it is not restricted to Eureka. Preconfigured provider redirects continue automatically. For a new top-level GET navigation, the dashboard displays the exact hostname and an **Approve provider & continue** button. This approval lasts for the current run only and preserves its browser session. Each additional new domain asks again. Only approve sites you recognize and are authorized to use.

Embedded surveys, popups, image questions and custom widgets pause rather than guessing. Cross-provider POST submissions are blocked and never replayed through the approval button. These transitions need manual inspection; stop the run before changing persistent allowed domains. There is no CAPTCHA solving, sign-in bypass or invented eligibility information.

## Mobile use

The dashboard layout supports small screens, but this application’s Node/Chromium engine requires a computer. It does **not** run independently on iOS or Android, and the dashboard currently binds only to the host computer. You can operate the computer through trusted remote-desktop software from a phone. Native phone operation and secure paired remote dashboard access are not implemented. Do not expose port 4317 to your LAN or the internet as a workaround.

## No-cost answering and ChatGPT

- The runnable app accepts only `provider: "manual"`. OpenAI and Anthropic API keys are not read by the dashboard.
- Deterministic profile matching and cached answers make no model requests.
- The review panel exports only the current question, choices and relevant facts into a copyable prompt. It does not include the whole page or conversation history.
- Open ChatGPT, paste the prompt, check the result and paste its JSON answer back. This uses your existing account subject to its own plan limits; the app cannot establish or guarantee unlimited free messages/uploads.
- OpenAI/Anthropic provider library adapters remain available for developers, with mock-only tests. They are not connected to the no-cost UI.
- Natural wording is supported for truthful responses. The system does not invent demographics or optimize false claims for survey eligibility.

Relevant official documentation: [Codex authentication](https://learn.chatgpt.com/docs/auth) distinguishes subscription and API access; [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) describes API JSON schemas.

## Keep it running

The supervisor restarts a crashed app with backoff, stopping after five consecutive short failures. It does not keep a sleeping or closed laptop awake. Leave the laptop powered, connected and signed in to its desktop.

**Windows login startup**, after installation, from a normal PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WindowsStartup.ps1
```

This registers a per-user Task Scheduler task named `SurveyAgent`. It uses the logged-in desktop rather than a Windows service. To remove it:

```powershell
Unregister-ScheduledTask -TaskName SurveyAgent
```

**macOS login startup**:

```sh
node scripts/macos-startup.mjs install
```

To remove it:

```sh
node scripts/macos-startup.mjs remove
```

Installing login startup is optional; the app never installs it automatically. These installers have not been exercised on a Windows host in this development session. Enterprise device policies can restrict startup registration.

On restart, previous active runs are marked interrupted. **Start a new inspection run after an interrupted application restart** is an optional setting: it opens the configured start URL using the saved session and re-inspects the current page. It does not replay an in-flight action or guarantee exactly-once submission across power loss.

## Storage, backup and corrections

Default data folders:

- Windows: `%LOCALAPPDATA%\SurveyAgent`
- macOS: `~/Library/Application Support/SurveyAgent`
- Linux: `~/.local/share/survey-agent`

Override with `SURVEY_AGENT_DATA_DIR`. The UI shows the resolved folder under Getting started. A repository-local `.env` is optional and ignored by Git.

The directory contains `settings.json`, `agent.sqlite`, a dedicated `browser-profile/`, and review-only `screenshots/` (at most 20). SQLite stores stable facts, preferences, temporary facts, reusable mappings, historical answers, corrections, runs, reviews and operational audit events separately. Model prompts and credentials are not written into operational logs.

Use **Correct** to explicitly change an established fact. The previous value stays in correction history; changes invalidate cached mappings. **Clear reusable answer mappings** preserves profile facts and past answers. Cache entries expire after 30 days; only explicitly marked reusable human answers and deterministic profile answers enter memory.

Stop the app before backing up or moving the SQLite file and settings. Keep this folder private: it contains personal information and browser credentials, and the database is not encrypted at rest. Establish browser sign-ins separately on each laptop; do not transfer the browser profile. Use the operating system's disk encryption and user account protections.

## Development

```sh
corepack pnpm dev
corepack pnpm check
```

`check` runs formatting, lint, strict typechecking, build and tests. All browser tests use locally hosted mock applications; provider tests use synthetic responses. No real survey or paid inference is used by tests.

The GitHub workflow targets Windows, macOS and Linux with Node 24. Local macOS verification is not proof that the remote Windows job has passed.

Module boundaries:

| Component                  | Responsibility                                                                |
| -------------------------- | ----------------------------------------------------------------------------- |
| browser                    | Chromium sessions, allowlists, snapshots and verified interactions            |
| extraction / normalization | Semantic question grouping, conservative fact binding and scoped fingerprints |
| storage                    | SQLite migrations, profile facts, corrections, memory and run history         |
| providers                  | Compact typed provider interface, strict response parsing, no-cost handoff    |
| decision / validation      | Profile/cache-first decisions, contradictions and action validation           |
| execution / runtime        | Structured actions, bounded runs, pause/review/resume and stale-page checks   |
| logging / config           | Redacted operational records and validated settings                           |
| ui / mock                  | Local authenticated dashboard and mock surveys                                |

SQLite migration version 3 uses portable scalar/JSON-text records and string run IDs. A future PostgreSQL implementation will need its own migration and SQL adapter; it is not currently supported.

## Current limits

This is a tested local application, not a certified integration with every Eureka provider. Unknown personal information requires input. Ordinary ChatGPT prompts are manual. Native installers, automatic updates, multi-user hosting, automatic image interpretation, embedded third-party frames and custom widget adapters are not included.
