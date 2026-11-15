import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createServer } from "http";
import type { AddressInfo } from "net";

import open from "open";

import { t } from "../i18n/index.js";

const AUTH_URL = "https://openrouter.ai/auth";
const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: codeChallengeS256(verifier) };
}

export function buildAuthUrl(
  callbackUrl: string | undefined,
  challenge: string,
  state?: string,
): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (callbackUrl) url.searchParams.set("callback_url", callbackUrl);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function parseCodeFromRequestLine(line: string): string | undefined {
  const target = line.split(/\s+/)[1];
  if (!target) return undefined;
  const url = new URL(target, "http://localhost");
  return url.searchParams.get("code")?.trim() || undefined;
}

export interface CallbackServer {
  url: string;
  waitForCode: (
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<string | undefined>;
  close: () => Promise<void>;
}

function equalState(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function startCallbackServer(
  state?: string,
): Promise<CallbackServer> {
  let pendingCode: string | undefined;
  let closed = false;
  const listeners = new Set<(code: string | undefined) => void>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const code = url.searchParams.get("code")?.trim();
    const accepted =
      !closed &&
      pendingCode === undefined &&
      request.method === "GET" &&
      url.pathname === "/callback" &&
      code &&
      (state === undefined || equalState(url.searchParams.get("state"), state));
    const body = accepted
      ? "Signed in. You can close this page and return to the terminal."
      : "Waiting for a valid sign-in callback.";
    response.writeHead(
      accepted || url.pathname === "/favicon.ico" ? 200 : 400,
      {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        Connection: "close",
      },
    );
    response.end(body);
    if (accepted) {
      pendingCode = code;
      for (const listener of listeners) listener(code);
    }
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  // Keep state in the callback itself even if the provider does not echo OAuth state.
  const callback = new URL(`http://127.0.0.1:${address.port}/callback`);
  if (state) callback.searchParams.set("state", state);
  return {
    url: callback.href,
    waitForCode: (timeoutMs, signal) => {
      if (pendingCode || closed || signal?.aborted)
        return Promise.resolve(pendingCode);
      return new Promise((resolve) => {
        const finish = (code: string | undefined) => {
          clearTimeout(timer);
          listeners.delete(finish);
          signal?.removeEventListener("abort", abort);
          resolve(code);
        };
        const abort = () => finish(undefined);
        const timer = setTimeout(abort, timeoutMs);
        listeners.add(finish);
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      for (const listener of listeners) listener(undefined);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function exchangeCodeForKey(
  code: string,
  verifier: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(KEYS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: "S256",
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(t("setup.openrouterFailed", { status: response.status }));
  const body = (await response.json()) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) throw new Error(t("setup.openrouterNoKey"));
  return key;
}

export interface BrowserLoginResult {
  key?: string;
  url: string;
  error?: string;
}

export interface BrowserLoginOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onUrl?: (url: string) => void;
}

export async function startBrowserLogin(
  openBrowser: (url: string) => Promise<unknown> = open,
  options: BrowserLoginOptions = {},
): Promise<BrowserLoginResult> {
  if (options.signal?.aborted)
    return { url: "", error: t("setup.browserLoginCancelled") };
  const pkce = generatePkce();
  const state = randomBytes(32).toString("base64url");
  const callback = await startCallbackServer(state);
  const url = buildAuthUrl(callback.url, pkce.challenge, state);
  try {
    options.onUrl?.(url);
    void Promise.resolve()
      .then(() => openBrowser(url))
      .catch(() => undefined);
    const code = await callback.waitForCode(
      options.timeoutMs ?? AUTH_TIMEOUT_MS,
      options.signal,
    );
    if (!code)
      return {
        url,
        error: t(
          options.signal?.aborted
            ? "setup.browserLoginCancelled"
            : "setup.browserLoginTimedOut",
        ),
      };
    const key = await exchangeCodeForKey(code, pkce.verifier, options.signal);
    return { key, url };
  } catch (error) {
    if (options.signal?.aborted)
      return { url, error: t("setup.browserLoginCancelled") };
    throw error;
  } finally {
    await callback.close();
  }
}
