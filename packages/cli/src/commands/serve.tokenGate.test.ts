import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isLoopbackServeHost,
  serveTokenGateHandler,
  serveTokenRefusal,
} from "./serve.helpers.js";

/**
 * The serve API can post prompts and approve tool permissions, so the token
 * gate is the one thing between a reachable instance and an anonymous client.
 * These cases pin the two halves: which hosts may stay anonymous (loopback
 * only, by exact name), and what a gated request must carry.
 */

interface FakeRequest {
  headers: Record<string, string>;
  query: Record<string, string>;
}

function fakeResponse(): {
  statusValue: number | undefined;
  bodyValue: unknown;
  status(code: number): unknown;
  json(payload: unknown): unknown;
} {
  const response: {
    statusValue: number | undefined;
    bodyValue: unknown;
    status(code: number): unknown;
    json(payload: unknown): unknown;
  } = {
    statusValue: undefined,
    bodyValue: undefined,
    status(code: number) {
      response.statusValue = code;
      return response;
    },
    json(payload: unknown) {
      response.bodyValue = payload;
      return response;
    },
  };
  return response;
}

function runGate(
  handler: ReturnType<typeof serveTokenGateHandler>,
  req: { headers?: Record<string, string>; query?: Record<string, string> },
): {
  response: ReturnType<typeof fakeResponse>;
  next: ReturnType<typeof vi.fn>;
} {
  const next = vi.fn();
  const response = fakeResponse();
  handler(
    {
      headers: req.headers ?? {},
      query: req.query ?? {},
    } as never,
    response as never,
    next,
  );
  return { response, next };
}

describe("the serve token gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("treats the loopback names, and only them, as token-optional", () => {
    expect(isLoopbackServeHost(undefined)).toBe(true);
    expect(isLoopbackServeHost("127.0.0.1")).toBe(true);
    expect(isLoopbackServeHost("localhost")).toBe(true);
    expect(isLoopbackServeHost("::1")).toBe(true);
    expect(isLoopbackServeHost("LOCALHOST")).toBe(true);
    // 127.0.0.2 answers on the loopback interface too, but the exact-name list
    // keeps the decision conservative: an unexpected spelling demands a token.
    expect(isLoopbackServeHost("127.0.0.2")).toBe(false);
    expect(isLoopbackServeHost("0.0.0.0")).toBe(false);
    expect(isLoopbackServeHost("192.168.1.5")).toBe(false);
    expect(isLoopbackServeHost("[::]")).toBe(false);
  });

  it("refuses a non-loopback bind without a token, and allows it with one", () => {
    const refusal = serveTokenRefusal("0.0.0.0", undefined);
    expect(refusal).toContain("TNT_SERVE_TOKEN");
    expect(refusal).toContain("0.0.0.0");

    expect(serveTokenRefusal("0.0.0.0", "s3cret")).toBeUndefined();
    expect(serveTokenRefusal("127.0.0.1", undefined)).toBeUndefined();
    expect(serveTokenRefusal(undefined, undefined)).toBeUndefined();
  });

  it("passes a request that presents the token, and rejects the rest", () => {
    const handler = serveTokenGateHandler("s3cret");

    const allowed = runGate(handler, {
      headers: { authorization: "Bearer s3cret" },
    });
    expect(allowed.next).toHaveBeenCalled();
    expect(allowed.response.statusValue).toBeUndefined();

    const viaQuery = runGate(handler, { query: { token: "s3cret" } });
    expect(viaQuery.next).toHaveBeenCalled();

    const viaCookie = runGate(handler, {
      headers: { cookie: "tnt_webui_token=s3cret" },
    });
    expect(viaCookie.next).toHaveBeenCalled();

    const deniedRequests: {
      headers?: Record<string, string>;
      query?: Record<string, string>;
    }[] = [
      { headers: {} },
      { headers: { authorization: "Bearer wrong" } },
      { headers: { authorization: "s3cret" } },
      { query: { token: "wrong" } },
      { headers: { cookie: "tnt_webui_token=wrong" } },
    ];
    for (const denied of deniedRequests) {
      const attempt = runGate(handler, denied);
      expect(attempt.next, JSON.stringify(denied)).not.toHaveBeenCalled();
      expect(attempt.response.statusValue, JSON.stringify(denied)).toBe(401);
    }
  });
});
