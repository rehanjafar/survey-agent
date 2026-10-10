export interface ReviewNotification {
  readonly reason: string;
  readonly host: string;
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
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      // Host and reason only: no survey URL tokens, questions, answers, cookies or screenshots.
      body:
        event.reason === "test_notification"
          ? "Phone alerts are working. Return to Survey Agent and click I received it."
          : `Paused: ${event.reason} on ${event.host}. Resolve this in the running Chrome window. The agent will recheck before resuming.`
    });
    if (!response.ok)
      throw new Error(
        `Phone notification failed (HTTP ${response.status}). The agent remains paused.`
      );
  }
}
