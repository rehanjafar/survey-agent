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
    /^(?:log[ -]?in|sign[ -]?in)(?:\s|$)/i.test(state.title.trim()) ||
    /^(?:log[ -]?in|sign[ -]?in)$/i.test(state.text.trim()) ||
    /\b((?:log[ -]?in|sign[ -]?in) (?:to continue|with your|to your)|verification code|two-factor|session expired)\b/i.test(
      state.text
    ) ||
    (state.controls.some((control) => ["email", "password"].includes(control.inputType ?? "")) &&
      state.controls.some(
        (control) =>
          control.kind === "button" && /^(?:log[ -]?in|sign[ -]?in)$/i.test(control.label.trim())
      ))
  )
    return "authentication_required";
  return undefined;
}
