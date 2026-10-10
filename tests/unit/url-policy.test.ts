import { describe, expect, it } from "vitest";

import { isAllowedUrl } from "../../src/browser/url-policy.js";

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
});

describe("explicit subdomain rules", () => {
  const domains = new Set(["*.survey.example.test"]);
  it("allows the apex and nested subdomains", () => {
    expect(isAllowedUrl("https://survey.example.test", domains)).toBe(true);
    expect(isAllowedUrl("https://a.b.survey.example.test", domains)).toBe(true);
  });
  it.each([
    "https://evilsurvey.example.test",
    "https://survey.example.test.evil.test",
    "https://user:pass@survey.example.test",
    "javascript:alert(1)"
  ])("rejects %s", (url) => {
    expect(isAllowedUrl(url, domains)).toBe(false);
  });
  it("ignores global wildcard and URL rules", () => {
    expect(isAllowedUrl("https://example.test", new Set(["*", "https://example.test"]))).toBe(
      false
    );
  });
});
