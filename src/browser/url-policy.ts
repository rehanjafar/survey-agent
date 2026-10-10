export class NavigationBlockedError extends Error {}

/** Exact hosts or explicit *.host rules (including the apex); never learn trust from redirects. */
export function validateDomainRule(rule: string): boolean {
  const host = rule.startsWith("*.") ? rule.slice(2) : rule;
  if (!host || host.includes("*") || /[/:@?#\\\s]/.test(host)) return false;
  if (rule.startsWith("*.") && (!host.includes(".") || /^\d+[.\d]*$/.test(host))) return false;
  return (
    host === "localhost" ||
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host)
  );
}

export function isAllowedUrl(targetUrl: string, allowedDomains: ReadonlySet<string>): boolean {
  try {
    const url = new URL(targetUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return [...allowedDomains].some((raw) => {
      const rule = raw.trim().toLowerCase();
      if (!validateDomainRule(rule)) return false;
      return rule.startsWith("*.")
        ? host === rule.slice(2) || host.endsWith(`.${rule.slice(2)}`)
        : host === rule;
    });
  } catch {
    return false;
  }
}
