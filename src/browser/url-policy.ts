export function isAllowedUrl(targetUrl: string, allowedDomains: ReadonlySet<string>): boolean {
  let url: URL;

  try {
    url = new URL(targetUrl);
  } catch {
    return false;
  }

  return (
    (url.protocol === "http:" || url.protocol === "https:") && allowedDomains.has(url.hostname)
  );
}
