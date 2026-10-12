# Advanced terminal workflow

The desktop dashboard described in [README](../README.md) is the recommended path.
`pnpm start` now opens that dashboard. The separate terminal workflow remains under
`corepack pnpm guided` (menu), `corepack pnpm setup` (terminal setup), and
`corepack pnpm agent <command>` (commands below). Terminal runs use `./data` by
default and `guided-settings.json`; dashboard data uses the OS application-data
folder and a separate settings schema. Run only one workflow at a time. Existing
older terminal settings may need setup rerun; credentials and phone topics remain
in their original folder. The dashboard preserves the merged PR's richer question
validation and manual-review UI; the terminal loop supports one question at a time.

A local survey agent for explicitly authorized environments. It reuses Playwright,
Eureka offer discovery, normalized questions, SQLite answer memory, and
validated structured actions. It can run supported survey pages automatically,
using your eligible ChatGPT plan, and pause with a phone notification when a human
needs to resolve a CAPTCHA or login problem.

## Setup

Requires Node.js 24+, Corepack/pnpm 11, and installed Google Chrome.

```sh
corepack pnpm install
cp .env.example .env
corepack pnpm check
```

Configure these values in `.env`:

```dotenv
SURVEY_AGENT_ALLOWED_DOMAINS=eurekasurveys.com,*.eurekasurveys.com
SURVEY_AGENT_AUTH_DOMAINS=
SURVEY_AGENT_SURVEY_DOMAINS=
SURVEY_AGENT_LLM_PROVIDER=chatgpt_plan
SURVEY_AGENT_CHATGPT_ACCOUNT=default
SURVEY_AGENT_CHATGPT_MODEL=
SURVEY_AGENT_MAX_SURVEYS=10
SURVEY_AGENT_MAX_STEPS=100
SURVEY_AGENT_REVIEW_TIMEOUT_MINUTES=60
```

Add your actual authorized identity-provider, routing, and external survey hosts.
The example does not assert that these are all Eureka hosts. A redirect cannot
approve its own destination. Unknown destinations stop for configuration review.

### Connect your ChatGPT plan

```sh
corepack pnpm agent chatgpt-login
corepack pnpm agent chatgpt-models
```

Sign in and authorize Survey Agent in the browser. Select a model from the returned
account-specific list and set `SURVEY_AGENT_CHATGPT_MODEL` in `.env`. Run this once
per account label; use another `SURVEY_AGENT_CHATGPT_ACCOUNT` label for a different
account/workspace. Registered client IDs and the host ID are retained across runs.
Tokens are verified, stored under `data/` with restrictive POSIX modes where supported
(Windows uses user-folder permissions), and renewed before
expiry. A refresh lock prevents concurrent token renewal. A hard crash may leave a
lock file; remove it only after confirming the original process is no longer running.
Disconnect access through ChatGPT settings when needed.

This uses the supported [ChatGPT plan usage flow](https://developers.openai.com/siwc/token-sharing-open-source)
for eligible open-source/local apps. It automates model requests using an OAuth
grant; it does not type into or read your existing ChatGPT conversations. Requests
use the public Responses endpoint with `store=false`, streamed through completion.
No paid API key is used and errors/limits never switch to a paid provider. ChatGPT
plan limits and any credits you allow in ChatGPT Settings → Usage still apply; set
the app's credit limits there to match your budget. Account eligibility and live
sign-in have to be verified with your account; automated tests use mocked OAuth/model
responses rather than consuming your plan.

### Enable phone alerts

```sh
corepack pnpm agent notify-setup
```

Install ntfy on your phone, subscribe to the printed topic on `ntfy.sh`, and enable
notifications. Confirm delivery with:

```sh
corepack pnpm agent notify-test
```

The generated random topic is saved in `data/notification.json`. Topic URLs on the
public server are subscription secrets; don't share them. For an existing or
access-controlled topic, configure `SURVEY_AGENT_NTFY_TOPIC_URL` and optionally
`SURVEY_AGENT_NTFY_TOKEN`. Publishing uses HTTPS, a timeout, and rejects redirects.
See [ntfy's publishing documentation](https://docs.ntfy.sh/publish/) and
[phone subscription setup](https://docs.ntfy.sh/subscribe/phone/) for device settings.
Notifications contain only the stop reason and hostname, not survey URLs, questions,
answers, credentials, screenshots, or browser cookies. Failed delivery stops the
run for local review. No SMS account or per-message SMS charges are involved.

### Log in to Eureka and run

```sh
corepack pnpm agent login https://eurekasurveys.com/surveys
corepack pnpm agent run https://eurekasurveys.com/surveys
```

Replace the URL with your authorized Eureka offer-page URL. Complete login yourself,
including CAPTCHA and verification, and reuse the same dedicated profile. The
managed CLI launches Google Chrome with `data/chrome-profile`; cookies and site
storage persist between runs. Do not point this at your everyday Chrome profile.
A runner lock prevents concurrent commands using the same data directory.

The automated command discovers the highest reward offer, follows approved external
popups/redirects, answers from memory or the ChatGPT plan, applies validated answers,
and advances through one unambiguous Next/Continue/Submit/Finish control. It returns
to the offer page after an explicit completion/disqualification page and starts the
next survey, up to the configured survey/step limits. Routine answers don't require
copy/paste or confirmation. Ctrl+C interrupts the run and cleans up the runner lock.

A visible CAPTCHA, framed CAPTCHA widget, password field, or login/verification page
pauses all answering and sends a phone alert. Resolve it in the open Chrome window
(or through your own remote desktop connection); the agent never solves or bypasses
it. It resumes only after two successive page captures show the stop condition has
cleared. It checks again before executing any model decision. The browser stays
open for other review stops and review timeouts; press Enter or Ctrl+C to disconnect.

Low confidence, unavailable context, unknown hosts, unsupported question types, multiple
question groups, ambiguous navigation controls, provider/usage failures, and pages
that don't advance remain review stops. The current generic extractor supports one
single-choice, dropdown, text, or numeric question per page. Matrices, checkbox
questions, nested survey frames, and arbitrary multi-question layouts need a specific
adapter before automatic execution. It does not claim universal survey coverage or
record inferred earnings as actual payment. Test only against local mocks.

## Authorized navigation model

Exact host rules restrict navigation to that host. Explicit `*.example.test` rules
permit the apex and its subdomains. Authentication hosts are separate from survey
hosts: Chrome can follow a configured login provider while the survey runner refuses
to answer questions there. Malformed rules, global wildcards, URL/userinfo rules,
non-HTTP(S) destinations, and suffix lookalikes are rejected. Empty allowlists fail
closed. The driver checks every HTTP redirect hop, including popup/frame navigation;
third-party image/script requests are outside this navigation policy.

A static vendor list cannot cover branded/private survey domains. Enable candidate
rules only for destinations covered by your authorization. SurveyMonkey's
[official allowlist](https://help.surveymonkey.com/en/surveymonkey/account/allow-list/)
includes `*.surveymonkey.com`, `*.surveymonkey.net`, `*.surveymk.com`, and `*.research.net`.
Alchemer's [link guide](https://help.alchemer.com/help/share-survey-via-link) documents
`*.alchemer.com`, with regional/custom-domain examples in its
[private-domain guide](https://help.alchemer.com/help/setting-up-a-link-to-your-survey-using-your-private-domain).
These are examples, not a claim that Eureka uses those vendors. Add each actual
custom host. No vendor hosts are enabled by default.

## Attached Chrome and manual review modes

`SURVEY_AGENT_BROWSER_MODE=attached_chrome` with a loopback CDP endpoint (for example
`http://127.0.0.1:9222`) reuses a logged-in tab matched by origin and path. Start a
separate Chrome instance with remote debugging and a dedicated profile, sign in
manually, and leave the exact offer-page tab open. Ordinary Chrome sessions without
remote debugging cannot be attached. Existing Chrome tabs remain open on agent
disconnect; navigation rules apply to the entire attached context while connected,
so keep unrelated tabs out of that instance. Managed mode blocks service workers
so navigation requests pass through the guard.

`SURVEY_AGENT_LLM_PROVIDER=manual_chatgpt` with `agent eureka <start URL>` remains an
optional one-question copy/paste review mode. It makes zero API calls. The library's
`AnswerDecisionEngine` also accepts an optional fourth fallback provider for
low-confidence/missing/invalid primary answers. Automated `run` accepts only
`chatgpt_plan` and never selects an existing paid-key provider implicitly.

## Verification and safety

`corepack pnpm check` runs formatting, lint, strict TypeScript, and unit/browser tests.
All browser tests use local mock surveys. OAuth, inference, and notifications are
mocked; no live surveys, real phone messages, or billable requests run in tests.

Never commit credentials, browser profiles, screenshots, answer history, logs, or
SQLite databases. The default `data/` directory and credential files are ignored.
No CAPTCHA solving, authentication bypass, anti-bot evasion, or concealment is
implemented. See [AGENTS.md](../AGENTS.md).
