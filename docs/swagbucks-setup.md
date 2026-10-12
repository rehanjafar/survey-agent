# Install and run continuous Swagbucks surveys

The current changes are on `codex/swagbucks-recovery-chrome-login`. Until it is merged, downloading `main` will not include them.

## Install on your Mac

1. Install **Node.js 24 or later** from <https://nodejs.org/en/download> and **Google Chrome** from <https://www.google.com/chrome/>, then reopen Terminal.
2. Download [the tested branch ZIP](https://github.com/rehanjafar/survey-agent/archive/refs/heads/codex/swagbucks-recovery-chrome-login.zip). Double-click the ZIP to extract it. Keep the extracted folder on your computer.
3. Open Terminal, type `cd ` (including the space), drag the extracted folder into Terminal, then press Return.
4. Run:

   ```sh
   node scripts/launch.mjs
   ```

5. Wait for installation and the browser download. The dashboard opens at <http://127.0.0.1:4317>. Keep Terminal open. The same command launches it on later runs; settings and logins persist outside the downloaded folder.

Windows: install Node.js 24+, extract the same ZIP, and double-click `Start-Windows.cmd`. Alternatively open PowerShell inside that folder and run the same command.

## One-time connections

1. In **Connections & setup**, click **Open Chrome for ChatGPT login**. This opens a normal, user-operated Chrome window using the agent's separate ChatGPT profile. Sign in yourself. **Quit that separate Chrome instance when finished** (on Mac use Chrome → Quit, not just the red window button).
2. Click **Open Chrome for Swagbucks login**, sign in yourself, and quit that separate Chrome instance too. Do not sign in through an automation-controlled window if Google displays “This browser or app may not be secure.” Google documents that it may block [software-controlled browser sign-ins](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=en).
3. Click **Open ordinary ChatGPT**. Select the normal conversation that contains the personal context you want used. Leave this agent-controlled window open. The agent uses available context there; it cannot assume access to all your other chats. Avoid using that chat for unrelated work during a run.
4. Install **ntfy** on your phone and allow notifications. Click **Set up phone alerts**, subscribe to the displayed server/topic, click **Send test alert**, verify receipt, then click **I received it**.
5. The dashboard now defaults to **Swagbucks**, **Installed Google Chrome**, **Automatic — ordinary ChatGPT chat**, continuous surveys, automatic consent/submission, and **Resolve uncertain answers automatically**. Older default settings upgrade once; an existing ChatGPT-plan connection is preserved. Later explicitly saved preferences remain intact.
6. Set your minimum **SB/hour** and maximum duration. Leave offer polling at **60 seconds**. Keep the provider catalog enabled for your authorized providers and keep the browser visible. Click **Save settings** and **Start**.

Login profiles are separate from your normal Chrome profile and the previous bundled Chromium profile. A new login is needed when switching browser profiles. If Chrome reports that a profile is already in use, quit the manual login instance before starting automation; do not delete your profile.

## During a run

- The agent ranks recognized eligible offers. If a visible SB card uses unfamiliar duration wording, ChatGPT can interpret it, subject to numeric checks and your reward/duration filters. It skips attempted survey IDs for the rest of the run.
- Completion, explicit screen-out, or unavailable-survey pages return to the list. With no new eligible offers, it waits and refreshes at your chosen interval. **Pause** and **Stop** interrupt this waiting.
- For a **survey CAPTCHA**, ntfy alerts you. Solve it in the survey browser. In continuous mode the agent rechecks and resumes automatically after the challenge clears. It never operates CAPTCHA controls. If notification delivery fails, it stays stopped.
- For a **ChatGPT CAPTCHA**, solve it in the ChatGPT window and click **Resume**. For temporary provider failures, autonomous mode waits 60 seconds and checks again. A dispatched ChatGPT message is tracked and read again after a timeout, rather than blindly resent.
- A low confidence score does not itself require approval. A supported objective answer or offered uncertainty/decline response can be used after normal control validation. Otherwise the agent makes one clarification attempt. Missing personal information, invalid/unavailable answers, unsupported surveys, and blocked provider handoffs cause that survey to be skipped and the next offer selected. Personal answers are never invented.
- Keep the computer awake, online, and the launcher running. Use **Stop** before closing the terminal or updating the app. A fresh run resets attempted-offer tracking.

## Verified behavior and limits

Tests use local mock pages, mock model replies, and mocked notifications. A full browser test covers unfamiliar offer-card interpretation, privacy-consent checkbox/button acceptance, answering, final submission, human-cleared CAPTCHA recovery, completion, screen-out, full surveys, subsequent offer selection, waiting, and pause. ntfy delivery must be tested on your actual phone. The live signed-in Swagbucks layout and your live ChatGPT session have not been validated by these tests.

Login and CAPTCHA still require you. Missing personal context and unsupported surveys are normally skipped automatically; provider outages wait rather than ask for answer approval. Browser crashes, changed ChatGPT layouts, startup failures, and notification delivery failures may still need troubleshooting. No implementation can guarantee a response from an unavailable external service or guaranteed earnings. Consent permission applies to privacy/cookies/participation agreements; it does not authorize purchases, subscriptions, account changes, or inventing eligibility statements. Completion is not a claim that Swagbucks credited SB.
