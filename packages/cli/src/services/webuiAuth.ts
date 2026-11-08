import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { Express, Request } from "express";

import { globalDir } from "../config/globalDir.js";
import { t } from "../i18n/index.js";
import {
  TOKEN_COOKIE,
  requestToken,
  tokenEquals,
} from "../utils/webuiToken.js";

export { requestToken, tokenEquals };

export const WEBUI_TOKEN_FILE = "webui-token";

/**
 * Read at call time rather than at import: a spec that mocks the path module
 * would otherwise fail while loading this file, before running a single case.
 */
export function webuiModuleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * The token this launch demands: reused from globalDir in long-lived mode
 * (0600, so only the user reads it), otherwise freshly generated.
 */
export function resolveWebUiToken(persistToken: boolean): string {
  if (!persistToken) {
    return crypto.randomBytes(32).toString("base64url");
  }

  const file = path.join(globalDir(), WEBUI_TOKEN_FILE);
  try {
    const persisted = fs.readFileSync(file, "utf8").trim();
    if (persisted.length > 0) {
      return persisted;
    }
  } catch {
    // Missing or unreadable: fall through to generating a fresh one.
  }

  const generated = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generated, { mode: 0o600 });
  try {
    // The mode option does not survive an existing file and some platforms
    // ignore it; the permission is the point of the file, so enforce it.
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows and sandboxes without chmod still get a usable token file.
  }
  return generated;
}

/**
 * The gate every route but the bootstrap pair sits behind. It must register
 * before the routes: the static routes end in a catch-all when the dist is
 * missing, and anything mounted after it never sees the request.
 */
export function registerWebUiAuthGate(app: Express, token: string): void {
  app.use((req, res, next) => {
    // Exempt: the bootstrap page and the exchange that mints the cookie.
    // Everything else - API routes, /app/* assets, the missing-dist
    // fallback - demands the token.
    if (req.method === "GET" && req.path === "/") {
      next();
      return;
    }
    if (req.method === "POST" && req.path === "/webui-session") {
      next();
      return;
    }
    if (tokenEquals(requestToken(req) ?? "", token)) {
      next();
      return;
    }
    res.status(401).json({ error: t("services.webuiUnauthorized") });
  });
}

/** The exchange that turns the launch token into the session cookie. */
export function registerWebUiSessionExchange(
  app: Express,
  token: string,
): void {
  app.post("/webui-session", (req: Request, res) => {
    const presented = req.body?.token;
    if (typeof presented !== "string" || !tokenEquals(presented, token)) {
      res.status(401).json({ error: t("services.webuiUnauthorized") });
      return;
    }
    res.setHeader(
      "Set-Cookie",
      `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
    );
    res.json({ ok: true });
  });
}
