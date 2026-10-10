import type { PageState } from "../browser/types.js";

export function pageStopReason(
  state: PageState
): "captcha_detected" | "authentication_required" | undefined {
  if (
    !state.captchaResponsePresent &&
    (state.captchaDetected ||
      state.hasCaptcha ||
      /\b(captcha|recaptcha|hcaptcha|verify you are human|security challenge)\b/i.test(
        `${state.title}\n${state.text}`
      ))
  )
    return "captcha_detected";
  if (
    state.hasAuthentication ||
    state.controls.some((control) => control.inputType === "password") ||
    /\b(log[ -]?in|sign[ -]?in|verification code|two-factor|session expired)\b/i.test(
      `${state.title}\n${state.text}`
    )
  )
    return "authentication_required";
  return undefined;
}
