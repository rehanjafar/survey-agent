# Install and run continuous Swagbucks surveys

The current changes are on `codex/swagbucks-survey-flow`, in pull request #5. Until it is merged, downloading `main` will not include them.

## Install on your Mac

1. Install **Node.js 24 or later** from <https://nodejs.org/en/download>, then reopen Terminal.
2. Download [the tested branch ZIP](https://github.com/rehanjafar/survey-agent/archive/refs/heads/codex/swagbucks-survey-flow.zip). Double-click the ZIP to extract it. Keep the extracted folder on your computer.
3. Open Terminal, type `cd ` (including the space), drag the extracted folder into Terminal, then press Return.
4. Run:

   ```sh
   node scripts/launch.mjs
   ```

5. Wait for installation and the browser download. The dashboard opens at <http://127.0.0.1:4317>. Keep Terminal open. The same command launches it on later runs; settings and logins persist outside the downloaded folder.

Windows: install Node.js 24+, extract the same ZIP, and double-click `Start-Windows.cmd`. Alternatively open PowerShell inside that folder and run the same command.

## One-time connections

1. Open **Connections & setup → Open ordinary ChatGPT**. Sign in manually in its separate browser window. Select the normal conversation that contains the personal context you want used.
2. Choose **Automatic — ordinary ChatGPT chat** as the answering mode. This sends questions and operational classifications through that conversation. The agent uses only context available there; it cannot assume access to all your other chats. Avoid using that same chat for unrelated work during a run.
3. Install the **ntfy** app on your phone and allow notifications. Click **Set up phone alerts** in the dashboard. Subscribe in ntfy to the exact displayed **Server** and **Topic**. Click **Send test alert**, verify receipt on the phone, then click **I received it**. Generating a topic alone is not sufficient.
4. Choose **Swagbucks**, with starting address `https://www.swagbucks.com/surveys`. Keep **Allow the built-in survey-provider catalog** enabled for the authorized providers you use. Add any other authorized survey hosts you already know to the domain list. Unknown hosts still require review.
5. Select **Displayed reward per minute**, set your minimum **SB/hour**, and maximum survey duration. A minimum of **0** and duration of **60** include a broad range of recognized offers; raise the minimum to be more selective. Advertised rates do not predict credited earnings.
6. Enable all three:
   - **Keep doing Swagbucks surveys**
   - **Automatically accept privacy policies, cookies, and survey participation consent on my behalf**
   - **Automatically submit completed surveys**
7. Set **Check for new offers every** to **60 seconds**. Keep the browser visible, and use **100** maximum actions per survey initially. Click **Save settings**.
8. Click **Start**. Sign in to Swagbucks manually if prompted, then click **Resume** after login. After initial setup, supported survey selection, consent, questions, navigation, submissions, and returns to the offer list run automatically.

## During a run

- The agent ranks recognized eligible offers. If a visible SB card uses unfamiliar duration wording, ChatGPT can interpret it, subject to numeric checks and your reward/duration filters. It skips attempted survey IDs for the rest of the run.
- Completion, explicit screen-out, or unavailable-survey pages return to the list. With no new eligible offers, it waits and refreshes at your chosen interval. **Pause** and **Stop** interrupt this waiting.
- For a **survey CAPTCHA**, ntfy alerts you. Solve it in the survey browser. In continuous mode the agent rechecks and resumes automatically after the challenge clears. It never operates CAPTCHA controls. If notification delivery fails, it stays stopped.
- For a **ChatGPT CAPTCHA**, solve it in the ChatGPT window and click **Resume** in the dashboard. ChatGPT connection failures and timed-out replies may need inspection before retrying; potentially submitted survey actions are not blindly replayed.
- Keep the computer awake, online, and the launcher running. Use **Stop** before closing the terminal or updating the app. A fresh run resets attempted-offer tracking.

## Verified behavior and limits

Tests use local mock pages, mock model replies, and mocked notifications. A full browser test covers unfamiliar offer-card interpretation, privacy-consent checkbox/button acceptance, answering, final submission, human-cleared CAPTCHA recovery, completion, screen-out, full surveys, subsequent offer selection, waiting, and pause. ntfy delivery must be tested on your actual phone. The live signed-in Swagbucks layout and your live ChatGPT session have not been validated by these tests.

Zero intervention beyond CAPTCHA cannot be guaranteed: login expiry, ChatGPT limits, missing personal context, unclear controls, unsupported widgets, new domains, and delivery/network failures can still require attention. Consent permission applies to privacy/cookies/participation agreements; it does not authorize purchases, subscriptions, account changes, or inventing eligibility statements. Completion is not a claim that Swagbucks credited SB.
