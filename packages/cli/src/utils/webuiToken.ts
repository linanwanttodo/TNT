import crypto from "crypto";
import type { IncomingMessage } from "http";

export const TOKEN_COOKIE = "tnt_webui_token";

/** The token a request carries: the session cookie or a Bearer header. */
export function requestToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }

  const cookies = req.headers.cookie;
  if (typeof cookies !== "string") {
    return undefined;
  }
  for (const segment of cookies.split(";")) {
    const at = segment.indexOf("=");
    if (at === -1 || segment.slice(0, at).trim() !== TOKEN_COOKIE) {
      continue;
    }
    return segment.slice(at + 1).trim();
  }
  return undefined;
}

/** Constant-time token comparison; lengths are guarded before comparing. */
export function tokenEquals(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    presentedBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(presentedBytes, expectedBytes)
  );
}
