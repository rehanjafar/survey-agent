# Survey Agent

A local dashboard for explicitly authorized survey work on **Prolific, Branded
Surveys, Eureka, and supported generic survey pages**. It keeps browser logins and
truthful profile facts on your computer, can use your eligible ChatGPT plan for
supported answers, and sends **ntfy phone alerts** when you need to intervene.
No paid API fallback, CAPTCHA solving, authentication bypass, or concealment.

## 1. Download and launch — after merging PR #2

Use the updated **main** branch after the merge. An older downloaded ZIP will not
update itself.

1. Install **Node.js 24 or later** using the installer for your computer from
   [nodejs.org](https://nodejs.org/en/download). Reopen Terminal/PowerShell afterward.
2. Open [the repository](https://github.com/rehanjafar/survey-agent), select **main**,
   click the green **Code** button, then **Download ZIP**. Extract the ZIP completely.
3. Keep the extracted folder in a normal local folder. Do not open `public/index.html`
   directly: the dashboard needs its local server.
4. Launch from the extracted folder:
   - **Windows:** double-click `Start-Windows.cmd`.
   - **Mac:** double-click `Start-macOS.command`. If macOS will not run it, use Terminal
     as shown below instead; no system security settings need to be disabled.

For a fresh Mac download extracted to `Downloads/survey-agent-main`, open Terminal
and paste these two lines:

```sh
cd "$HOME/Downloads/survey-agent-main"
node scripts/launch.mjs
```

On Windows, open the extracted folder in File Explorer, type `powershell` in its
address bar, press Enter, then run `node scripts/launch.mjs` if the launcher did not
open. If your folder has another name/location, open a terminal there instead.

The launcher installs the locked dependencies, downloads its own Chromium browser,
builds the app, and opens **http://127.0.0.1:4317**. Allow several minutes on first
launch. You do not need to install Git, pnpm, Corepack, or Chrome separately for the
dashboard. Internet is required for installation. Keep the terminal window open
while using the agent; use **Stop** in the dashboard before closing it.

**Already downloaded an older version?** Stop its run and close its launcher first.
Download/extract the new main ZIP into a new folder and launch it. Default dashboard
settings, facts, history, and Eureka login are kept outside the source folder and
reused. Prolific and Branded each receive a separate saved browser profile. Do not
run the old and new copies simultaneously. If you previously set a custom
`SURVEY_AGENT_DATA_DIR`, use the same absolute folder to retain that data.

## 2. Set up ntfy on your phone — once

You have not set this up merely by generating a topic on the computer. Your phone
must subscribe, and you must verify delivery.

1. Install **ntfy** from the [iPhone App Store](https://apps.apple.com/us/app/ntfy/id1625396347)
   or [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy).
   Open it and allow notifications.
2. In Survey Agent, open **Connections & setup** and click **Set up phone alerts**.
3. The dashboard displays two values:
   - **Server:** `https://ntfy.sh`
   - **Topic:** `survey-agent-` followed by random letters and numbers.
4. In the phone app, tap **+** / **Subscribe to topic**. Keep the server as `ntfy.sh`
   (or enter `https://ntfy.sh` if asked). In the **topic name** field enter **only**
   the displayed `survey-agent-…` text, not the full URL. Copy it through your own
   private notes/message to yourself if typing it is inconvenient. Subscribe.
5. Back in the dashboard, click **Send test alert**. Your phone should receive
   **Survey Agent test alert**. Only after you see it, click **I received it**.

The dashboard now says **Phone delivery confirmed**. It reuses the same topic on
future launches. No SMS service or account is required for this default public ntfy
setup. Treat the random topic as private: anyone who knows it may subscribe or
publish to it. Messages contain a review reason and hostname, not survey answers,
credentials, or complete survey URLs. [Official ntfy phone guide](https://docs.ntfy.sh/subscribe/phone/).

**No test alert?** Check the server/topic spelling, phone notification permissions,
and Focus/Do Not Disturb. Open the topic in ntfy to see whether a message arrived.
On Android, ntfy's instant-delivery option can help with delayed background alerts.
Do not confirm delivery until an actual notification reaches your phone.

An alert does **not** solve a CAPTCHA remotely. Open the survey browser on your
computer, complete the CAPTCHA or login yourself, then click **Resume** in the
dashboard. Failed delivery leaves the run stopped for local review.

## 3. Connect ChatGPT and choose your platform

In **Connections & setup**:

1. Click **Connect ChatGPT**. Complete the sign-in/authorization in the browser.
   If no tab opens, use the sign-in link displayed in the dashboard.
2. Wait for **Connected**. On a later launch, **Refresh available models** checks your
   saved connection. Choose a model from the available model list.
3. Select **Automatic — ChatGPT plan** as the answering mode. This uses eligible
   ChatGPT plan access, not browser copy/paste or an API key. Plan limits and any
   credits you enable in ChatGPT still apply; it is not a promise of unlimited/free
   inference. If access is unavailable, the app stops rather than enabling paid API
   billing. **Saved facts and manual review** remains an optional mode.
4. Choose **Prolific**, **Branded Surveys**, or **Eureka**. This fills in the starting
   address and base domain. Add only actual external survey hosts covered by your
   authorization. Put identity-provider hosts in **Login-only domains** so the agent
   can reach them without treating them as surveys. Do not paste a URL into a domain
   field; use a hostname such as `study.example.org` or an explicit `*.example.org` rule.
5. For Prolific, choose USD or GBP. For Branded, the minimum advertised hourly reward
   is **points per hour**, not dollars. Set the maximum study duration if desired.
   These filters apply to Prolific/Branded; Eureka has its own ranking selector.
6. Keep the browser visible for initial login. Enable **Automatically submit completed
   surveys** only if you want supported final Submit/Finish controls to run without
   another confirmation. Click **Save settings**.

Unknown destinations stop for review. The dashboard can explicitly approve a blocked
GET destination for the current run; it never silently trusts a redirect or replays
a blocked form submission. After stopping, add a recurring authorized provider to
settings for future runs. Login-only hosts remain separate from answerable hosts.

## 4. Add your facts, log in, and run

1. Open **My profile** and add your own truthful facts and preferences. Confirm
   each entry. Missing demographics, experiences, and opinions are not invented.
2. Optionally use **Try local practice** first. It uses local mock pages and manual
   mode, not your ChatGPT plan or a real survey account.
3. Click **Start** on the overview. Complete platform login/verification manually in
   the survey browser if prompted, then click **Resume**. Sign-ins persist locally.
   Registration, waitlists, and account approval still require your action.
4. Supported answers run from established facts, confirmed memory, or your selected
   ChatGPT model. Review stops show their reason in the dashboard and send an alert
   if phone delivery has been confirmed. Stop the run before changing settings.

The dashboard finishes at detected survey completion; click Start for another run.
Complex study instructions, consent, platform completion-code forms, unsupported
widgets, ambiguous controls, and missing facts can require manual review. Never
invent a completion code. Keep the computer awake and online during runs.

## Updating and finding your data

The dashboard's **Getting started** area shows the actual data folder. Defaults:

- Mac: `~/Library/Application Support/SurveyAgent`
- Windows: `%LOCALAPPDATA%\SurveyAgent`
- Linux: `~/.local/share/survey-agent`

Stop the app before backing up this folder. It contains private facts, browser
sessions, ChatGPT credentials, and the ntfy topic. Do not commit or publicly share it.
Older terminal-only runs used `./data`; they are separate and are not silently
imported into the dashboard. Do not copy an older terminal `settings.json` over the
dashboard settings. See [advanced commands](docs/advanced.md) if you still use that workflow.

## Troubleshooting

| What you see                              | What to do                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `node` is not found                       | Install Node.js 24+ and reopen the terminal/launcher.                                                |
| Blank page or disconnected                | Use the launcher; browse to `http://127.0.0.1:4317`, not an HTML file.                               |
| Port already in use                       | Close the older launcher, or open the already-running dashboard.                                     |
| ChatGPT not connected / model unavailable | Connect or refresh models, select a listed model, save settings. Check account eligibility/usage.    |
| Automatic run asks for phone setup        | Send a test, receive it on your phone, then click **I received it**.                                 |
| New provider blocked                      | Review the host and approve only within your authorization. POST handoffs need manual inspection.    |
| Missing information                       | Add the truthful fact or answer in the review panel.                                                 |
| CAPTCHA/login alert                       | Resolve in the survey browser, then **Resume**.                                                      |
| Profile conflict                          | Use the explicit profile correction flow; established facts are not silently replaced.               |
| No matching offers                        | Check currency, rate and duration filters. Unknown layouts or unavailable offers need manual review. |

## Scope and verification

The dashboard supports recognized native radio buttons, checkboxes, dropdowns, text,
numeric inputs, scales, labelled matrices, and conditional questions. Embedded
survey frames and custom controls may stop. Prolific/Branded ranking compares
advertised reward per minute within one unit; actual earnings depend on eligibility,
time, approval, and availability. Displayed rewards are not recorded as paid income.
Live platform layouts and account eligibility remain unverified.

Use only specifically authorized environments. General
[Prolific rules](https://participant-help.prolific.com/en/articles/445029-can-i-use-ai-assistance-tools-in-my-submission)
and [Branded terms](https://surveys.gobranded.com/page/branded-surveys-terms-of-service/)
restrict AI/automated participation outside applicable authorization. Domain approval
controls navigation; it does not grant research permission.

Developers: `corepack pnpm check` runs formatting, lint, strict TypeScript, build,
and local mock-browser tests. OAuth/model/ntfy calls are mocked in tests. See
[AGENTS.md](AGENTS.md) for the repository working agreement.
