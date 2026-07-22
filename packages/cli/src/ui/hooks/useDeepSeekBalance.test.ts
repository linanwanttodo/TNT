import { describe, expect, it, vi } from "vitest";

import { fetchDeepSeekBalance } from "./useDeepSeekBalance.js";

describe("fetchDeepSeekBalance", () => {
  it("queries the official endpoint and returns available currencies", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            is_available: true,
            balance_infos: [
              {
                currency: "CNY",
                total_balance: "110.00",
                granted_balance: "10.00",
                topped_up_balance: "100.00",
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await fetchDeepSeekBalance(
      {
        provider: "deepseek",
        apiBase: "https://api.deepseek.com",
        apiKey: "secret-test-key",
      },
      fetch as unknown as typeof globalThis.fetch,
    );

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://api.deepseek.com/user/balance"),
      expect.objectContaining({
        headers: { Authorization: "Bearer secret-test-key" },
      }),
    );
    expect(result).toEqual([{ currency: "CNY", total: "110.00" }]);
  });

  it("does not send credentials to a non-DeepSeek host", async () => {
    const fetch = vi.fn();
    const result = await fetchDeepSeekBalance(
      {
        provider: "deepseek",
        apiBase: "https://proxy.example.com/v1",
        apiKey: "secret-test-key",
      },
      fetch as unknown as typeof globalThis.fetch,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("does not query other provider accounts", async () => {
    const fetch = vi.fn();
    const result = await fetchDeepSeekBalance(
      {
        provider: "openai",
        apiBase: "https://api.openai.com/v1",
        apiKey: "secret-test-key",
      },
      fetch as unknown as typeof globalThis.fetch,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
