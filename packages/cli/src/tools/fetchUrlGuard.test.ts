import { describe, expect, it } from "vitest";

import { urlRefusal } from "./fetchUrlGuard.js";

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
