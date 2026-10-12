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
6. Complete **Phone replies from anywhere** below, including its test question.
7. Set your minimum **SB/hour** and maximum duration. Leave offer polling at **60 seconds**. Keep the provider catalog enabled for your authorized providers and keep the browser visible. Click **Save settings** and **Start**.

Login profiles are separate from your normal Chrome profile and the previous bundled Chromium profile. A new login is needed when switching browser profiles. If Chrome reports that a profile is already in use, quit the manual login instance before starting automation; do not delete your profile.

## Phone replies from anywhere

1. Install [Tailscale](https://tailscale.com/download) on the laptop and phone. Sign in to the same private Tailscale network and connect both devices. This works on mobile data as well as Wi-Fi.
2. With Survey Agent running, open a second Terminal window on the laptop and run:

   ```sh
   tailscale serve --bg http://127.0.0.1:4318
   ```

   On Mac, if Terminal says the command cannot be found, use:

   ```sh
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg http://127.0.0.1:4318
   ```

   Follow the HTTPS setup link if Tailscale prompts you. Use **Serve**, which shares within your private network. Do not enable public Funnel or share the main dashboard's port 4317. If you already use Serve for another app on this laptop, do not overwrite that existing setup; this guide assumes the default HTTPS endpoint is free. See [Tailscale's Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve).

3. Copy the HTTPS address printed by Tailscale, such as `https://laptop.example.ts.net`. In **Connections & setup → Reply from your phone, anywhere**, paste it and click **Save phone reply address**. Use your actual address, not the example.
4. Click **Send a test question to my phone**. Tap the ntfy alert, choose **Yes, this works**, and tap **Send answer to laptop**. The page should confirm that phone replies work. This test never changes a survey. Test once with phone Wi-Fi off to verify access away from home.
5. Start your survey run. When your input is needed, tap its ntfy notification, select or type your answer, and tap **Send answer to laptop**. Keep Tailscale connected, the laptop awake, and the agent running.

The phone page shows the question in its original language, with four actual survey choices first and **Show all choices** for the rest; long lists also have search. These are in survey order, not guesses about your demographics. No option is preselected. Numeric and free-text questions require your value; matrix and multiple-choice questions show their appropriate controls. No new personal-facts database is created.

Each private notification link can answer only its current question and becomes invalid after use, after leaving review, or when the app restarts. The laptop rechecks the live page and validates your answer before applying it. Questions and replies go through Tailscale; ntfy carries only the alert and private one-question link. Keep your ntfy topic and links private. If the reply page cannot connect, reconnect Tailscale on both devices and reopen the alert. If you receive another alert after sending, the page or answer needs another check. The app does not impose an answer timeout, but the survey website may expire its session while waiting.

## CAPTCHA and login help from your phone

1. On the laptop, open [Chrome Remote Desktop](https://remotedesktop.google.com/access) in Chrome. Use **Set up Remote Access**, install the host, name your laptop, and choose a PIN. Complete its requested macOS screen-recording and accessibility permissions. This is a one-time installation you perform; Survey Agent does not install or configure remote access for you.
2. On your phone, open the same address, sign into the same Google account, select the laptop, and enter your remote-access PIN. On iPhone, the web page can be added to your Home Screen. Android also supports the Chrome Remote Desktop app. See [Google's setup and phone-access instructions](https://support.google.com/chrome/answer/1649523?hl=en&co=GENIE.Platform%3DiOS).
3. In **Connections & setup → Solve CAPTCHAs from your phone**, click **Send Open laptop test alert**. With phone Wi-Fi off, tap **Open laptop**, or tap the notification itself if your ntfy client does not display action buttons. Select the laptop and confirm that you can move its pointer and use its browser. The test does not change an active survey.
4. When a CAPTCHA or login alert arrives, use that same link and complete the challenge or sign-in yourself in the laptop's existing Chrome window. Survey CAPTCHAs are rechecked automatically during continuous runs; for ChatGPT CAPTCHAs or authentication stops, also click **Resume** in the laptop dashboard through remote access.

The shortcut opens Google's computer list, not a preauthenticated session. Keep your PIN in Chrome Remote Desktop; never paste it into Survey Agent. Notifications contain no CAPTCHA images, survey answers, PINs, or browser credentials. Keep the laptop awake and online. Closing the lid may put it to sleep. Remote access must be tested on your devices; live CAPTCHA behavior is not covered by local tests. Tailscale continues to handle the separate phone-answer page; Chrome Remote Desktop handles the full laptop view.

## During a run

- The agent ranks recognized eligible offers. If a visible SB card uses unfamiliar duration wording, ChatGPT can interpret it, subject to numeric checks and your reward/duration filters. It skips attempted survey IDs for the rest of the run.
- Completion, explicit screen-out, or unavailable-survey pages return to the list. With no new eligible offers, it waits and refreshes at your chosen interval. **Pause** and **Stop** interrupt this waiting.
- For a **survey CAPTCHA**, ntfy alerts you with **Open laptop**. Connect from your phone and solve it yourself in the survey browser. In continuous mode the agent rechecks and resumes automatically after the challenge clears. It never operates CAPTCHA controls. If notification delivery fails, it stays stopped.
- For a **ChatGPT CAPTCHA**, use **Open laptop**, solve it in the ChatGPT window, and click **Resume** on the laptop dashboard. For temporary provider failures, autonomous mode waits 60 seconds and checks again. A dispatched ChatGPT message is tracked and read again after a timeout, rather than blindly resent.
- A low confidence score does not itself require approval. A supported objective answer or offered uncertainty/decline response can be used after normal control validation. Otherwise the agent makes one clarification attempt. Missing personal information or an unresolved answer pauses the survey and sends a phone reply link. It waits for you instead of skipping. Unsupported pages without a readable question, blocked provider handoffs, and contradictory saved answers still need inspection on the laptop; these are not ordinary answer choices. Personal answers are never invented.
- Keep the computer awake, online, and the launcher running. Use **Stop** before closing the terminal or updating the app. A fresh run resets attempted-offer tracking.

## Verified behavior and limits

Tests use local mock pages, mock model replies, and mocked notifications. A full browser test covers unfamiliar offer-card interpretation, privacy-consent checkbox/button acceptance, answering, final submission, human-cleared CAPTCHA recovery, completion, screen-out, full surveys, subsequent offer selection, waiting, and pause. ntfy delivery must be tested on your actual phone. The live signed-in Swagbucks layout and your live ChatGPT session have not been validated by these tests. Local phone-browser tests cover answering on a mobile layout, resuming the laptop survey, all supported answer formats, stale/duplicate reply rejection, and a separate test question. Your actual mobile-data/Tailscale connection must be verified using the test question.

Login and CAPTCHA still require you. Missing personal context waits for your phone answer; unsupported pages remain paused, and provider outages wait before checking again. Browser crashes, changed ChatGPT layouts, startup failures, and notification delivery failures may still need troubleshooting. No implementation can guarantee a response from an unavailable external service or guaranteed earnings. Consent permission applies to privacy/cookies/participation agreements; it does not authorize purchases, subscriptions, account changes, or inventing eligibility statements. Completion is not a claim that Swagbucks credited SB.
