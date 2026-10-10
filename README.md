# Survey Agent

A local assistant for **explicitly authorized** survey automation, with Prolific,
Branded Surveys, and Eureka workflows. It uses saved Chrome sessions, your eligible
ChatGPT plan, and ntfy phone alerts. No paid API fallback is enabled.

## Start here

You need **Node.js 24+, Corepack, and Google Chrome** installed. Open a terminal in
this project's folder and run:

```sh
corepack pnpm install
corepack pnpm start
```

The first launch walks you through setup. **You do not need to create or edit `.env`.**

1. Choose **Prolific**, **Branded**, or **Eureka**. The dashboard address is filled in.
2. Add any external survey and login hosts covered by your authorization. Leave them
   blank if unknown; an unknown redirect pauses instead of being automatically trusted.
3. Set your reward and time preferences. For Prolific, choose USD or GBP. For Branded,
   the minimum rate is in **points per hour**, not dollars.
4. Sign in to ChatGPT when prompted and choose one of your account's available models.
5. Subscribe to the displayed topic in the **ntfy** phone app and send a test alert.

The menu then offers **Log in**, **Run authorized surveys**, **Change settings**, or
**Exit**. Choose Log in the first time, complete any verification in Chrome, then
press Enter. Start the menu again and choose Run. Each platform has its own saved
Chrome session. Account registration, waitlists, and verification remain manual.

After setup, the only command you need is:

```sh
corepack pnpm start
```

Switch platforms or adjust preferences through **Change settings**. To repair or
rerun setup directly, use `corepack pnpm setup`. Setup choices and login sessions
stay on your computer in the ignored `data/` directory. Your existing ntfy topic is
reused. Switching platforms creates a separate Chrome profile; existing Eureka
sessions from the older command-line workflow are not copied automatically.

## How it chooses work

- **Prolific:** compares advertised reward per minute within your selected currency;
  opens recognized study cards and follows an unambiguous “Start now” / “Start study”
  handoff to an authorized external host.
- **Branded:** compares advertised points per minute and follows approved survey links.
  It does not assume a cash conversion rate for points or apply reward boosts.
- Both skip missing or ambiguous reward/duration information, disabled/full offers,
  offers outside your preferences, and offers already attempted during this run.
  Unknown layouts stop for review rather than guessing. There is no background
  reservation loop or automatic refresh when no matching offers are available.
- **Eureka:** retains its existing highest-total-reward selection. The guided
  minimum-rate/duration preferences currently apply to Prolific and Branded only.

Advertised rates are estimates, **not guaranteed earnings**. Screen-outs, waiting,
actual completion time, availability, and payment approval affect the result. The
agent does not claim a study reward has been paid merely because a page says complete.

## When your phone alerts

A CAPTCHA or login problem pauses the agent. Resolve it in the open Chrome window;
it resumes after checking that the problem cleared. It never solves CAPTCHAs or
bypasses verification. Unknown domains, ambiguous pages, missing profile facts, and
other review stops require your attention. Failed notification delivery stops the run.

Routine supported answers need no copy/paste. ChatGPT plan eligibility, usage limits,
and any credits you permit in ChatGPT settings still apply. There is no automatic
switch to a paid API provider. Phone setup and real delivery must be verified by you.

## Scope and current limits

Use only platform/study environments covered by your explicit authorization.
[Prolific's general rules](https://participant-help.prolific.com/en/articles/445029-can-i-use-ai-assistance-tools-in-my-submission)
otherwise prohibit AI answers unless the researcher requests them;
[Branded's general terms](https://surveys.gobranded.com/page/branded-surveys-terms-of-service/)
also restrict automated activity. A domain setting controls navigation; it does not
grant permission or override a researcher's instructions.

The current answer engine supports one single-choice, dropdown, text, or numeric
question per page. Multi-question pages, checkboxes, matrices, embedded survey
frames, consent flows, and completion-code entry may require manual review. The
Prolific/Branded workflows never answer platform account forms or invent completion
codes. Import your own truthful facts when needed; see the
[advanced guide](docs/advanced.md#import-truthful-profile-facts).

These adapters are **tested on local mock sites, not verified against your live
accounts**. Platform layouts can change. No live surveys or phone messages are sent
by the tests. Run `corepack pnpm check` to verify the project.

Older commands, custom domain configuration, profile import, and attached-Chrome
options are in the [advanced guide](docs/advanced.md).
