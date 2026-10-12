/** Only fixed, user-safe messages cross the UI boundary, never remote bodies or tokens. */
export class ProviderError extends Error {
  public constructor(
    message: string,
    public readonly reviewReason:
      "provider_error" | "captcha_detected" | "authentication_required" = "provider_error",
    public readonly reviewHost?: string
  ) {
    super(message);
  }
}
export function providerHttpError(status: number): ProviderError {
  const reason =
    status === 401
      ? "ChatGPT sign-in expired. Reconnect ChatGPT."
      : status === 403
        ? "This ChatGPT account has not granted eligible plan access. Reconnect and check the consent screen."
        : status === 429
          ? "ChatGPT usage limit reached. Check ChatGPT Settings > Usage and wait for the limit to reset."
          : status === 400 || status === 404
            ? "The selected ChatGPT model or request is unavailable. Refresh models and save an available model."
            : "ChatGPT is temporarily unavailable. Check connectivity and retry.";
  return new ProviderError(reason + " No paid fallback was attempted.");
}
