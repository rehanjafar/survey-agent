import { describe, expect, it } from "vitest";

import { isAllowedUrl, isAllowedDocument } from "../../src/browser/url-policy.js";

describe("isAllowedUrl", () => {
  const allowedDomains = new Set(["survey.example.test", "localhost"]);

  it("allows configured HTTP(S) domains", () => {
    expect(isAllowedUrl("https://survey.example.test/question/1", allowedDomains)).toBe(true);
    expect(isAllowedUrl("http://localhost:3000", allowedDomains)).toBe(true);
  });

  it("rejects malformed, unconfigured, and non-HTTP URLs", () => {
    expect(isAllowedUrl("not a URL", allowedDomains)).toBe(false);
    expect(isAllowedUrl("https://other.example.test", allowedDomains)).toBe(false);
    expect(isAllowedUrl("file:///tmp/survey.html", allowedDomains)).toBe(false);
  });
  it("allows subdomains only in compatible mode without accepting lookalike suffixes", () => {
    expect(isAllowedUrl("https://login.survey.example.test", allowedDomains, true)).toBe(true);
    expect(isAllowedUrl("https://login.survey.example.test", allowedDomains)).toBe(false);
    expect(isAllowedUrl("https://evilsurvey.example.test", allowedDomains, true)).toBe(false);
    expect(isAllowedUrl("https://survey.example.test.evil.test", allowedDomains, true)).toBe(false);
  });
  it("lets verification frames load only as embedded components of approved sites", () => {
    const frame = "https://www.google.com/recaptcha/api2/anchor?k=test";
    const parent = "https://survey.example.test/login";
    expect(isAllowedDocument(frame, allowedDomains, true, true, parent)).toBe(true);
    expect(isAllowedDocument(frame, allowedDomains, false, true, parent)).toBe(false);
    expect(isAllowedDocument(frame, allowedDomains, true, false, parent)).toBe(false);
    expect(isAllowedDocument(frame, allowedDomains, true, true, "https://unapproved.test")).toBe(
      false
    );
    for (const url of [
      "https://www.google.com/search",
      "https://www.google.com.evil.test/recaptcha/api2",
      "http://www.google.com/recaptcha/api2",
      "https://secret@www.google.com/recaptcha/api2",
      "https://www.google.com/recaptcha/../search"
    ]) {
      expect(isAllowedDocument(url, allowedDomains, true, true, parent)).toBe(false);
    }
  });
});
