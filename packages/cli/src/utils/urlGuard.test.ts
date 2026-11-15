import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, fetchMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));

import {
  assertPublicHttpUrl,
  fetchPublicUrl,
  hasConfiguredSearchEndpoint,
  resolveConfiguredSearchEndpoint,
} from "./urlGuard.js";

beforeEach(() => {
  lookupMock.mockReset();
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-HTTP protocols without touching the network", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(
      /non-HTTP/i,
    );
    await expect(assertPublicHttpUrl("ftp://example.com/file")).rejects.toThrow(
      /non-HTTP/i,
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects every reserved IPv4 range class", async () => {
    const blocked = [
      "0.0.0.1",
      "10.1.2.3",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.255",
      "224.0.0.1",
      "240.0.0.1",
    ];
    for (const address of blocked) {
      await expect(assertPublicHttpUrl(`http://${address}/x`)).rejects.toThrow(
        /private or reserved/,
      );
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("accepts public IPv4 literals without DNS", async () => {
    const url = await assertPublicHttpUrl("https://93.184.216.34/search");
    expect(url.hostname).toBe("93.184.216.34");
    await expect(
      assertPublicHttpUrl("http://8.8.8.8/"),
    ).resolves.toBeInstanceOf(URL);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects reserved IPv6 ranges including mapped IPv4", async () => {
    const blocked = [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
    ];
    for (const address of blocked) {
      await expect(
        assertPublicHttpUrl(`http://[${address}]/x`),
      ).rejects.toThrow(/private or reserved/);
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("accepts a public IPv6 literal", async () => {
    await expect(
      assertPublicHttpUrl("http://[2606:4700::1111]/x"),
    ).resolves.toBeInstanceOf(URL);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects internal hostnames before DNS", async () => {
    await expect(assertPublicHttpUrl("http://localhost/x")).rejects.toThrow(
      /internal host/,
    );
    await expect(assertPublicHttpUrl("http://box.internal/x")).rejects.toThrow(
      /internal host/,
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([
      { address: "10.0.0.5", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]);
    await expect(
      assertPublicHttpUrl("https://rebind.example/x"),
    ).rejects.toThrow(/private or reserved/);
    expect(lookupMock).toHaveBeenCalledWith("rebind.example", { all: true });
  });

  it("accepts a hostname that resolves fully public", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      assertPublicHttpUrl("https://example.com/x"),
    ).resolves.toBeInstanceOf(URL);
  });

  it("fails closed when the hostname does not resolve", async () => {
    lookupMock.mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    );
    await expect(assertPublicHttpUrl("https://nope.example/x")).rejects.toThrow(
      /private or reserved|ENOTFOUND/,
    );
  });

  it("lets an explicitly allowed host through, but never the protocol check", async () => {
    await expect(
      assertPublicHttpUrl("http://127.0.0.1:9200/x", {
        allowedHosts: ["127.0.0.1"],
      }),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertPublicHttpUrl("ftp://127.0.0.1/x", { allowedHosts: ["127.0.0.1"] }),
    ).rejects.toThrow(/non-HTTP/i);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("fetchPublicUrl", () => {
  it("returns the response when no redirect happens", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock.mockResolvedValue(new Response("ok", { status: 200 })),
    );
    const response = await fetchPublicUrl("https://93.184.216.34/x");
    expect(await response.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect into a private address", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "http://10.0.0.9/inside" },
        }),
      ),
    );
    await expect(fetchPublicUrl("https://93.184.216.34/x")).rejects.toThrow(
      /private or reserved/,
    );
  });

  it("follows a redirect to a public address with the original init", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://93.184.216.34/next" },
        }),
      )
      .mockResolvedValueOnce(new Response("arrived", { status: 200 }));
    const response = await fetchPublicUrl("https://93.184.216.34/first", {
      headers: { Authorization: "Bearer t" },
    });
    expect(await response.text()).toBe("arrived");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1];
    expect(String(secondCall[0])).toBe("https://93.184.216.34/next");
    expect(
      (secondCall[1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer t");
    expect(secondCall[1].redirect).toBe("manual");
  });

  it("gives up after five hops", async () => {
    let hop = 0;
    vi.stubGlobal(
      "fetch",
      fetchMock.mockImplementation(async () => {
        hop += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `https://93.184.216.34/hop${hop}` },
        });
      }),
    );
    await expect(fetchPublicUrl("https://93.184.216.34/start")).rejects.toThrow(
      /exceeded 5 hops/,
    );
  });
});

describe("resolveConfiguredSearchEndpoint", () => {
  it("fails when no endpoint is configured", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", "");
    await expect(resolveConfiguredSearchEndpoint()).rejects.toThrow(
      /not configured/,
    );
  });

  it("rejects a private endpoint outside the allowlist", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", "http://127.0.0.1:8080/search");
    await expect(resolveConfiguredSearchEndpoint()).rejects.toThrow(
      /allowlist/,
    );
  });

  it("allows a private endpoint the user explicitly allowlisted", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", "http://127.0.0.1:8080/search");
    vi.stubEnv("TNT_WEB_SEARCH_HOSTS", "127.0.0.1");
    const endpoint = await resolveConfiguredSearchEndpoint();
    expect(endpoint.hostname).toBe("127.0.0.1");
  });

  it("rejects a public host that is not on the allowlist", async () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", "https://93.184.216.34/search");
    await expect(resolveConfiguredSearchEndpoint()).rejects.toThrow(
      /allowlist/,
    );
  });
});

describe("hasConfiguredSearchEndpoint", () => {
  it("reflects the configured endpoint", () => {
    vi.stubEnv("TNT_WEB_SEARCH_URL", "");
    expect(hasConfiguredSearchEndpoint()).toBe(false);
    vi.stubEnv("TNT_WEB_SEARCH_URL", "https://api.tavily.com/search");
    expect(hasConfiguredSearchEndpoint()).toBe(true);
  });
});
