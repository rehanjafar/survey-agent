export function isAllowedUrl(
  targetUrl: string,
  allowedDomains: ReadonlySet<string>,
  includeSubdomains = false
): boolean {
  let url: URL;

  try {
    url = new URL(targetUrl);
  } catch {
    return false;
  }

  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    (allowedDomains.has(url.hostname) ||
      (includeSubdomains && [...allowedDomains].some((host) => url.hostname.endsWith("." + host))))
  );
}

// Verification frames may load, but are never selected as survey destinations.
// This does not solve or interact with any challenge.
export function isVerificationFrame(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ["www.google.com", "www.recaptcha.net"].includes(url.hostname) &&
      url.pathname.startsWith("/recaptcha/")
    );
  } catch {
    return false;
  }
}

export function isAllowedDocument(
  value: string,
  allowed: ReadonlySet<string>,
  compatible: boolean,
  embedded: boolean,
  parentUrl: string
): boolean {
  return (
    isAllowedUrl(value, allowed, compatible) ||
    (compatible &&
      embedded &&
      isAllowedUrl(parentUrl, allowed, compatible) &&
      isVerificationFrame(value))
  );
}
