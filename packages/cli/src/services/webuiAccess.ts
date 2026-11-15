import os from "node:os";

import type { Express, Request, Response } from "express";

import { logger } from "../utils/logger.js";

export interface WebUiAccessHandle {
  port: number;
  token: string;
}

export interface WebUiAccessContext {
  /** The bound server, once it is listening. */
  getHandle(): WebUiAccessHandle | null;
  /** The interface the server was asked to bind. */
  getBoundHost(): string;
  /**
   * Rebinds a loopback-only server onto every interface, so the browser can
   * open the phone-pairing panel and get a scannable code instead of a
   * command to copy. Absent when the service cannot rebind.
   */
  enableLan?(): Promise<WebUiAccessHandle | null>;
}

/** The addresses that mean "every interface" when the server binds a LAN. */
export const LAN_BIND_HOSTS = new Set(["0.0.0.0", "::", "::0"]);

/**
 * The IPv4 addresses of this machine that a phone on the same network could
 * reach. Loopback and link-local addresses are skipped: the first one is not
 * routable, the second only carries DHCP.
 */
export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      if (!addresses.includes(entry.address)) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

/**
 * The addresses a phone may open, each carrying the token in the fragment the
 * browser turns into a session cookie. The loopback address is always first:
 * it is the one that works when the server never left the machine.
 */
export function webuiAccessUrls(
  handle: WebUiAccessHandle,
  boundHost: string,
): { lanEnabled: boolean; urls: string[] } {
  const lanEnabled = LAN_BIND_HOSTS.has(boundHost);
  const hosts = lanEnabled ? lanAddresses() : [];
  const urls = [
    `http://127.0.0.1:${handle.port}/#token=${handle.token}`,
    ...hosts.map(
      (host) => `http://${host}:${handle.port}/#token=${handle.token}`,
    ),
  ];
  return { lanEnabled, urls };
}

/**
 * `GET /api/access` answers what a phone needs to reach this server: whether
 * the server listens on the network at all, and the URLs that carry the
 * token. `POST /api/access/lan` asks a loopback-only server to rebind onto
 * every interface so the pairing panel can show a working QR code without
 * the user retyping a start command. Both sit behind the same token gate as
 * the rest of the API.
 */
export function registerWebUiAccessRoute(
  app: Express,
  ctx: WebUiAccessContext,
): void {
  app.get("/api/access", (_req: Request, res: Response) => {
    const handle = ctx.getHandle();
    if (!handle) {
      res.status(503).json({ error: "webui.not-listening" });
      return;
    }
    res.json({
      port: handle.port,
      ...webuiAccessUrls(handle, ctx.getBoundHost()),
    });
  });

  app.post("/api/access/lan", (_req: Request, res: Response) => {
    // Acknowledge before rebinding: the rebind closes the very listener this
    // request arrived on, so awaiting it here would kill the response socket
    // and the browser would read a network error instead of the answer.
    res.json({ ok: true });
    void (async () => {
      if (!ctx.enableLan) {
        return;
      }
      try {
        await ctx.enableLan();
      } catch (error) {
        logger.warn?.(
          `WebUiService: LAN rebind failed (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    })();
  });
}
