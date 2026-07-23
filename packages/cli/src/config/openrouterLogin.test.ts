import { get as httpGet } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { t } from "../i18n/index.js";

import {
  buildAuthUrl,
  codeChallengeS256,
  exchangeCodeForKey,
  generatePkce,
  parseCodeFromRequestLine,
  startBrowserLogin,
  startCallbackServer,
} from "./openrouterLogin.js";

describe("OpenRouter browser login", () => {
  it("uses the RFC 7636 S256 vector", () => {
    expect(
      codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates a verifier the challenge can reproduce", () => {
    const pair = generatePkce();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(pair.challenge).toBe(codeChallengeS256(pair.verifier));
    expect(pair.challenge).not.toMatch(/[=+/]/);
  });

  it("encodes the loopback callback, the challenge, and the state", () => {
    const url = new URL(
      buildAuthUrl("http://localhost:51234/callback", "CHAL", "STATE"),
    );
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("code_challenge")).toBe("CHAL");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("callback_url")).toBe(
      "http://localhost:51234/callback",
    );
  });

  it("reads a percent-encoded code from the callback request line", () => {
    expect(
      parseCodeFromRequestLine("GET /callback?code=abc%2Bxyz HTTP/1.1"),
    ).toBe("abc+xyz");
    expect(parseCodeFromRequestLine("GET /callback HTTP/1.1")).toBeUndefined();
  });

  it("rejects a callback whose state does not match and ignores the favicon probe", async () => {
    const callback = await startCallbackServer("expected-state");
    try {
      await new Promise<void>((resolve) => {
        httpGet(
          `${callback.url.replace("/callback", "/favicon.ico")}`,
          (response) => {
            response.resume();
            response.on("end", () => resolve());
          },
        );
      });
      await new Promise<void>((resolve) => {
        httpGet(
          `${new URL(callback.url).origin}/callback?code=wrong&state=other`,
          (response) => {
            response.resume();
            response.on("end", () => resolve());
          },
        );
      });
      await expect(callback.waitForCode(30)).resolves.toBeUndefined();
    } finally {
      await callback.close();
    }
  });

  it("cancels a pending browser login and closes its listener", async () => {
    const openBrowser = vi.fn(async (_url: string) => undefined);
    const controller = new AbortController();
    const pending = startBrowserLogin(openBrowser, {
      signal: controller.signal,
      timeoutMs: 5000,
    });
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      error: t("setup.browserLoginCancelled"),
    });
  });

  it("times out without leaving the callback listener open", async () => {
    const openBrowser = vi.fn(async (_url: string) => undefined);
    const started = Date.now();
    await expect(
      startBrowserLogin(openBrowser, { timeoutMs: 20 }),
    ).resolves.toMatchObject({ error: t("setup.browserLoginTimedOut") });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("opens the browser and exchanges the callback code for a key", async () => {
    const openBrowser = vi.fn(async (_url: string) => undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ key: "sk-or-v1-live" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const pending = startBrowserLogin(openBrowser);
      await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledTimes(1));
      const authUrl = new URL(openBrowser.mock.calls[0]![0] as string);
      const callbackUrl = new URL(authUrl.searchParams.get("callback_url")!);
      callbackUrl.searchParams.set("code", "test-code");
      await new Promise<void>((resolve) => {
        httpGet(callbackUrl, (response) => {
          response.resume();
          response.on("end", () => resolve());
        });
      });
      const result = await pending;
      expect(result.key).toBe("sk-or-v1-live");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/auth/keys",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"code":"test-code"'),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports a failed key exchange without leaking the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    try {
      await expect(exchangeCodeForKey("code", "verifier")).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
