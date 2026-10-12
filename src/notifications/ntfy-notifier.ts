export const remoteDesktopUrl = "https://remotedesktop.google.com/access";

export interface ReviewNotification {
  readonly reason: string;
  readonly host: string;
  readonly answerUrl?: string;
}
export interface ReviewNotifier {
  notify(event: ReviewNotification): Promise<void>;
}

export class NtfyNotifier implements ReviewNotifier {
  public constructor(
    private readonly topicUrl: string,
    private readonly token?: string
  ) {
    const url = new URL(topicUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z0-9_-]{1,64}$/.test(url.pathname)
    )
      throw new Error("ntfy requires an HTTPS topic URL without credentials or query parameters.");
  }
  public async notify(event: ReviewNotification): Promise<void> {
    const remote = ["captcha_detected", "authentication_required", "remote_desktop_test"].includes(
      event.reason
    );
    const clickUrl = remote ? remoteDesktopUrl : event.answerUrl;
    const response = await fetch(this.topicUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        title:
          event.reason === "test_notification"
            ? "Survey Agent test alert"
            : "Survey Agent needs attention",
        priority: event.reason === "captcha_detected" ? "urgent" : "high",
        tags: "warning",
        ...(clickUrl ? { click: clickUrl } : {}),
        ...(remote ? { actions: `view, Open laptop, ${remoteDesktopUrl}` } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      // No questions, answers, credentials or challenge content in push messages.
      // Remote desktop uses a fixed login-protected destination, never a survey URL.
      body:
        event.reason === "test_notification"
          ? "Phone alerts are working. Return to Survey Agent and click I received it."
          : remote
            ? event.reason === "remote_desktop_test"
              ? "Remote access test: tap Open laptop (or this notification), select your computer, and enter your Chrome Remote Desktop PIN. This test does not pause or change a survey."
              : `Paused: ${event.reason} on ${event.host}. Tap Open laptop, select your computer, and resolve this yourself in its browser. Survey CAPTCHAs resume automatically in continuous mode after clearing; for ChatGPT or login, click Resume on the laptop dashboard.`
            : event.answerUrl
              ? "An answer is needed. Tap this alert to choose your answer on your phone. The laptop will recheck the survey and continue."
              : `Paused: ${event.reason} on ${event.host}. Resolve this in the running Chrome window. The agent will recheck before resuming.`
    });
    if (!response.ok)
      throw new Error(
        `Phone notification failed (HTTP ${response.status}). The agent remains paused.`
      );
  }
}
