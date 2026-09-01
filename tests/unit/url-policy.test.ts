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
