import dns from "dns/promises";
import net from "net";

const MAX_REDIRECT_HOPS = 5;

export interface PublicUrlOptions {
  /**
   * Hosts the caller has explicitly configured as trusted. An allowlisted
   * host skips the private-range checks (the protocol check always runs), so
   * a user-configured endpoint may point at loopback.
   */
  allowedHosts?: string[];
}

/**
 * Guard for server-side URL fetches: only http/https may pass, and the host
 * must resolve outside localhost, loopback, private, and reserved ranges.
 * Hostnames are resolved with DNS so a public-looking name pointing at an
 * internal address (DNS rebinding) is rejected too. Unresolvable hosts fail
 * closed. Allowed hosts opt out of the range checks by explicit configuration.
 */
export async function assertPublicHttpUrl(
  input: string | URL,
  opts: PublicUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${String(input)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked non-HTTP(S) URL: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (opts.allowedHosts?.includes(host)) {
    return url;
  }

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Blocked internal host: ${host}`);
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateAddress(host)) {
      throw new Error(`Blocked private or reserved address: ${host}`);
    }
    return url;
  }

  const resolved = await dns.lookup(host, { all: true });
  if (
    resolved.length === 0 ||
    resolved.some((entry) => isPrivateAddress(entry.address))
  ) {
    throw new Error(
      `Blocked host resolving to a private or reserved address: ${host}`,
    );
  }
  return url;
}

/**
 * Validate a URL the operator named explicitly (hook endpoint, remote CLI,
 * sync endpoint, MCP server). The protocol check always runs; the host is
 * normalized and passed as trusted, so a deliberately self-hosted endpoint
 * on loopback keeps working while nothing unconfigured is reachable.
 */
export async function assertConfiguredHttpUrl(
  input: string | URL,
): Promise<URL> {
  const url = input instanceof URL ? input : new URL(String(input));
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return assertPublicHttpUrl(url, { allowedHosts: [host] });
}

/**
 * Fetch a URL the operator named explicitly: validate, then fetch once.
 */
export async function fetchConfiguredUrl(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(await assertConfiguredHttpUrl(input), init);
}

/**
 * Fetch a URL that passes assertPublicHttpUrl, following redirects by hand:
 * every hop's Location is validated again, so a redirect chain cannot walk a
 * public URL into an internal address. Headers and the abort signal carry
 * over to every hop.
 */
export async function fetchPublicUrl(
  input: string | URL,
  init: RequestInit & { allowedHosts?: string[] } = {},
): Promise<Response> {
  const current = await assertPublicHttpUrl(input, {
    allowedHosts: init.allowedHosts,
  });
  const { allowedHosts, ...forwarded } = init;
  let response = await fetch(current, { ...forwarded, redirect: "manual" });
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      return response;
    }
    const next = await assertPublicHttpUrl(
      new URL(location, response.url || current),
      { allowedHosts },
    );
    response = await fetch(next, { ...forwarded, redirect: "manual" });
  }
  throw new Error(`Redirect chain exceeded ${MAX_REDIRECT_HOPS} hops`);
}

/** IPv4 CIDR containment over the four address bytes. */
function ipv4InCidr(bytes: number[], cidr: number[], prefix: number): boolean {
  const full = Math.floor(prefix / 8);
  for (let i = 0; i < full; i++) {
    if (bytes[i] !== cidr[i]) return false;
  }
  const rest = prefix % 8;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return ((bytes[full] ?? 0) & mask) === (cidr[full] & mask);
}

/** IPv6 CIDR containment over the eight 16-bit groups. */
function ipv6InCidr(groups: number[], cidr: number[], prefix: number): boolean {
  const full = Math.floor(prefix / 16);
  for (let i = 0; i < full; i++) {
    if (groups[i] !== cidr[i]) return false;
  }
  const rest = prefix % 16;
  if (rest === 0) return true;
  const mask = (0xffff << (16 - rest)) & 0xffff;
  return ((groups[full] ?? 0) & mask) === (cidr[full] & mask);
}

const PRIVATE_IPV4_RANGES: Array<{ cidr: number[]; prefix: number }> = [
  { cidr: [0, 0, 0, 0], prefix: 8 },
  { cidr: [10, 0, 0, 0], prefix: 8 },
  { cidr: [100, 64, 0, 0], prefix: 10 },
  { cidr: [127, 0, 0, 0], prefix: 8 },
  { cidr: [169, 254, 0, 0], prefix: 16 },
  { cidr: [172, 16, 0, 0], prefix: 12 },
  { cidr: [192, 0, 0, 0], prefix: 24 },
  { cidr: [192, 168, 0, 0], prefix: 16 },
  { cidr: [198, 18, 0, 0], prefix: 15 },
  { cidr: [224, 0, 0, 0], prefix: 4 },
  { cidr: [240, 0, 0, 0], prefix: 4 },
];

const PRIVATE_IPV6_RANGES: Array<{ cidr: number[]; prefix: number }> = [
  { cidr: [0, 0, 0, 0, 0, 0, 0, 0], prefix: 128 },
  { cidr: [0, 0, 0, 0, 0, 0, 0, 1], prefix: 128 },
  { cidr: [0, 0, 0, 0, 0, 0, 0, 0], prefix: 8 },
  { cidr: [0xfe80, 0, 0, 0, 0, 0, 0, 0], prefix: 10 },
  { cidr: [0xfc00, 0, 0, 0, 0, 0, 0, 0], prefix: 7 },
  { cidr: [0xff00, 0, 0, 0, 0, 0, 0, 0], prefix: 8 },
  { cidr: [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], prefix: 32 },
];

/** True for loopback, private, link-local, CGNAT, benchmark, ULA, and reserved ranges. */
function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const bytes = address.split(".").map(Number);
    return PRIVATE_IPV4_RANGES.some((range) =>
      ipv4InCidr(bytes, range.cidr, range.prefix),
    );
  }
  if (version === 6) {
    const groups = parseIpv6(address);
    if (groups === null) return true;
    // IPv4-mapped (::ffff:0:0/96): the embedded v4 address decides.
    const mapped =
      groups[0] === 0 &&
      groups[1] === 0 &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0xffff;
    if (mapped) {
      const bytes = [
        (groups[6] >> 8) & 0xff,
        groups[6] & 0xff,
        (groups[7] >> 8) & 0xff,
        groups[7] & 0xff,
      ];
      return PRIVATE_IPV4_RANGES.some((range) =>
        ipv4InCidr(bytes, range.cidr, range.prefix),
      );
    }
    return PRIVATE_IPV6_RANGES.some((range) =>
      ipv6InCidr(groups, range.cidr, range.prefix),
    );
  }
  return true;
}

/** Parses an IPv6 literal into its eight 16-bit groups; null when malformed. */
function parseIpv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = parseIpv6Sequence(halves[0] ?? "");
  if (head === null) return null;
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const tail = parseIpv6Sequence(halves[1] ?? "");
  if (tail === null) return null;
  if (head.length + tail.length >= 8) return null;
  const groups = [...head];
  while (groups.length < 8 - tail.length) groups.push(0);
  groups.push(...tail);
  return groups;
}

function parseIpv6Sequence(part: string): number[] | null {
  if (part === "") return [];
  const pieces = part.split(":");
  const groups: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (piece.includes(".")) {
      // An embedded IPv4 tail is only valid as the final piece.
      if (i !== pieces.length - 1) return null;
      const bytes = piece.split(".").map(Number);
      if (
        bytes.length !== 4 ||
        bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
      ) {
        return null;
      }
      groups.push((bytes[0] << 8) | bytes[1]);
      groups.push((bytes[2] << 8) | bytes[3]);
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
  }
  return groups;
}

const DEFAULT_SEARCH_HOSTS = [
  "lite.duckduckgo.com",
  "api.duckduckgo.com",
  "api.search.brave.com",
  "api.tavily.com",
  "google.serper.dev",
];

/**
 * Whether a JSON search endpoint is configured. The endpoint itself is only
 * obtainable through resolveConfiguredSearchEndpoint, which validates it.
 */
export function hasConfiguredSearchEndpoint(): boolean {
  const raw = process.env.TNT_WEB_SEARCH_URL;
  return typeof raw === "string" && raw.trim() !== "";
}

/**
 * Resolves the env-configured JSON search endpoint. The configured host must
 * appear on the allowlist (TNT_WEB_SEARCH_HOSTS overrides the defaults) and
 * is passed as an explicitly trusted host, so a self-hosted endpoint on
 * loopback works while nothing unconfigured is reachable.
 */
export async function resolveConfiguredSearchEndpoint(): Promise<URL> {
  const raw = process.env.TNT_WEB_SEARCH_URL;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("TNT_WEB_SEARCH_URL is not configured");
  }
  // The allowlist is the gate: parse just enough to name the host, reject
  // anything unlisted, and only then run the full guard with that one host
  // trusted, which is how a deliberate self-hosted endpoint stays possible.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked non-HTTP(S) URL: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowlist = (
    process.env.TNT_WEB_SEARCH_HOSTS ?? DEFAULT_SEARCH_HOSTS.join(",")
  )
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.includes(host)) {
    throw new Error(`Blocked search host not on the allowlist: ${host}`);
  }
  return assertPublicHttpUrl(raw, { allowedHosts: [host] });
}
