/**
 * Host checks for docs redirect destinations.
 *
 * The docs site never fetches these URLs itself, but a redirect target is
 * handed to the browser (and to any server-side consumer of the config), so
 * validate it before it leaves this process: http/https only, and never a
 * loopback, private or reserved host. Keep this dependency-free so the build
 * guard can use the same rules as the runtime.
 */
import net from "node:net";

export function isForbiddenRedirectHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (net.isIP(host) === 0) return false;
  if (host === "::1" || host === "0.0.0.0" || host.startsWith("::ffff:")) {
    return true;
  }
  const bytes = host.split(".").map(Number);
  if (bytes.length !== 4 || bytes.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = bytes;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export interface RedirectCheck {
  ok: boolean;
  reason?: string;
}

export function checkRedirectDestination(dest: string): RedirectCheck {
  if (/^[a-z][a-z0-9+.-]*:/i.test(dest) && !/^https?:\/\//i.test(dest)) {
    return { ok: false, reason: `non-http URL: ${dest}` };
  }
  if (!dest.startsWith("http://") && !dest.startsWith("https://")) {
    return { ok: true };
  }
  let url: URL;
  try {
    url = new URL(dest);
  } catch {
    return { ok: false, reason: `invalid URL: ${dest}` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `non-http protocol: ${url.protocol}` };
  }
  if (isForbiddenRedirectHost(url.hostname)) {
    return { ok: false, reason: `forbidden host: ${url.hostname}` };
  }
  return { ok: true };
}
