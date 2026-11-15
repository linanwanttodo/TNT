import { describe, expect, it, vi } from "vitest";

import { createGuardedFetch, urlRefusal } from "./fetchUrlGuard.js";

describe("the URL guard on Fetch", () => {
  it("reads ordinary pages, including a dev server", () => {
    for (const url of [
      "https://example.com/docs",
      "http://127.0.0.1:8080/index.html",
      "http://localhost:3000",
      "http://192.168.1.10:8443/wiki",
    ]) {
      expect(urlRefusal(url), url).toBeUndefined();
    }
  });

  it("refuses a scheme that is not http", () => {
    expect(urlRefusal("file:///etc/passwd")).toContain("http and https");
    expect(urlRefusal("data:text/html,<h1>x</h1>")).toContain("http and https");
    expect(urlRefusal("ftp://example.com/file")).toContain("http and https");
  });

  it("refuses the addresses cloud metadata answers on", () => {
    expect(urlRefusal("http://169.254.169.254/latest/meta-data/")).toContain(
      "metadata",
    );
    expect(urlRefusal("http://[fe80::1]/")).toContain("metadata");
    expect(
      urlRefusal("http://metadata.google.internal/computeMetadata"),
    ).toContain("metadata");
    expect(urlRefusal("http://0.0.0.0:8080/")).toContain("metadata");
  });

  it("refuses something that is not a URL at all", () => {
    expect(urlRefusal("example.com/docs")).toContain("absolute URL");
    expect(urlRefusal("")).toContain("absolute URL");
  });
});

describe("createGuardedFetch", () => {
  it("releases redirect bodies and strips credentials across origins", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const inner = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: "https://other.example/page" }),
        body: { cancel },
      })
      .mockResolvedValueOnce(new Response("ok"));
    const guarded = createGuardedFetch(inner as typeof fetch);
    await guarded("https://example.com/start", {
      headers: {
        authorization: "Bearer test",
        cookie: "test=value",
        accept: "text/html",
      },
    });
    expect(cancel).toHaveBeenCalledOnce();
    const headers = new Headers(inner.mock.calls[1][1].headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.get("accept")).toBe("text/html");
    expect(inner.mock.calls[0][1].redirect).toBe("manual");
  });

  it("bounds a redirect loop", async () => {
    const inner = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(null, { status: 302, headers: { location: "/loop" } }),
      );
    await expect(
      createGuardedFetch(inner as typeof fetch)("https://example.com/loop"),
    ).rejects.toThrow("too many redirects");
    expect(inner).toHaveBeenCalledTimes(6);
  });

  function stubFetch(
    handler: (url: string) => Promise<Pick<Response, "status" | "headers">>,
  ) {
    return vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        handler(String(_input)) as unknown as Response,
    );
  }

  it("lets an ordinary page through", async () => {
    const inner = stubFetch(() =>
      Promise.resolve({ status: 200, headers: new Headers() }),
    );
    const guarded = createGuardedFetch(inner as unknown as typeof fetch);
    const response = await guarded("https://example.com/docs");
    expect(response.status).toBe(200);
  });

  it("refuses a URL that fails the guard", async () => {
    const guarded = createGuardedFetch(
      stubFetch(() =>
        Promise.resolve({ status: 200, headers: new Headers() }),
      ) as unknown as typeof fetch,
    );
    await expect(
      guarded("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/metadata/);
  });

  it("refuses a redirect that lands on a guarded address", async () => {
    const inner = stubFetch((url: string) => {
      if (url === "https://example.com/redirect") {
        const headers = new Headers();
        headers.set("location", "http://169.254.169.254/latest/meta-data/");
        return Promise.resolve({ status: 302, headers });
      }
      return Promise.resolve({ status: 200, headers: new Headers() });
    });
    const guarded = createGuardedFetch(inner as unknown as typeof fetch);
    await expect(guarded("https://example.com/redirect")).rejects.toThrow(
      /metadata/,
    );
  });

  it("follows an allowed redirect chain", async () => {
    const inner = stubFetch((url: string) => {
      if (url === "https://example.com/start") {
        const headers = new Headers();
        headers.set("location", "https://example.com/final");
        return Promise.resolve({ status: 302, headers });
      }
      return Promise.resolve({ status: 200, headers: new Headers() });
    });
    const guarded = createGuardedFetch(inner as unknown as typeof fetch);
    const response = await guarded("https://example.com/start");
    expect(response.status).toBe(200);
  });
});
