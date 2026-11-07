import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isTransient, mcpRequestOptions } from "./mcpUtils.js";

const sseError = (code: number) =>
  // The constructor only stores the event; the tests run where ErrorEvent
  // does not exist, so a stand-in is enough.
  new SseError(code, `http ${code}`, {} as unknown as ErrorEvent);

describe("isTransient", () => {
  it("calls the retryable HTTP statuses transient", () => {
    for (const code of [408, 429, 500, 502, 503, 504]) {
      expect(isTransient(sseError(code)), `status ${code}`).toBe(true);
    }
  });

  it("does not retry statuses that a repeat cannot fix", () => {
    for (const code of [400, 401, 403, 404, 501]) {
      expect(isTransient(sseError(code)), `status ${code}`).toBe(false);
    }
    expect(isTransient(new StreamableHTTPError(501, "not implemented"))).toBe(
      false,
    );
  });

  it("recognizes socket resets and timeouts from the error text", () => {
    expect(isTransient(new Error("socket error: ECONNRESET"))).toBe(true);
    expect(isTransient(new Error("read EPIPE"))).toBe(true);
    expect(isTransient(new Error("Request timed out"))).toBe(true);
    expect(
      isTransient(
        new Error("Request failed", { cause: new Error("ECONNRESET") }),
      ),
    ).toBe(true);
  });

  it("leaves plain failures alone", () => {
    expect(isTransient(new Error("tool exploded"))).toBe(false);
    expect(isTransient(new Error("401 Unauthorized"))).toBe(false);
    expect(isTransient(undefined)).toBe(false);
    expect(isTransient("nope")).toBe(false);
  });
});

describe("mcpRequestOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to a ten-minute timeout with progress resets", () => {
    expect(mcpRequestOptions()).toEqual({
      timeout: 600_000,
      resetTimeoutOnProgress: true,
    });
  });

  it("reads the timeout from the environment", () => {
    vi.stubEnv("TNT_MCP_CALL_TIMEOUT_MS", "1234");
    expect(mcpRequestOptions().timeout).toBe(1234);
    expect(mcpRequestOptions().resetTimeoutOnProgress).toBe(true);
  });
});
