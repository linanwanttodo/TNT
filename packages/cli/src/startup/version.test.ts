import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { compareVersions, getLatestVersion, getVersion } from "./version.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("the version module", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers a version without a network probe on import", () => {
    // `getLatestVersion()` asks the releases API with a five-second budget. It
    // used to be called at module scope, so every importer - the LSP client
    // included - paid for it.
    const source = readFileSync(path.join(here, "version.ts"), "utf-8");

    expect(source).not.toMatch(/^getLatestVersion\(\)/m);
  });

  it("probes the releases API without blocking the event loop", async () => {
    // The probe used execFileSync inside the service-init phase, freezing the
    // whole process for as long as npm took and delaying first paint.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, _init?: unknown) =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({ tag_name: "v9.9.9" }),
                }),
              30,
            ),
          ),
      ),
    );

    let timersFired = 0;
    const pending = getLatestVersion();
    setTimeout(() => {
      timersFired += 1;
    }, 5);

    expect(await pending).toBe("9.9.9");
    expect(timersFired).toBe(1);
  });

  it("resolves the package version from the source tree as well as the bundle", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(here, "../../package.json"), "utf-8"),
    ) as { version: string };

    expect(getVersion()).toBe(pkg.version);
  });

  it("compares semver the way UpdateService reads it", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe("older");
    expect(compareVersions("1.2.4", "1.2.3")).toBe("newer");
    expect(compareVersions("1.2.3", "1.2.3")).toBe("same");
    expect(compareVersions("unknown", "1.2.3")).toBe("same");
  });

  it("advertises the resolved version to the language server, not a literal", () => {
    const client = readFileSync(path.join(here, "../lsp/client.ts"), "utf-8");

    expect(client).toContain("version: getVersion()");
    expect(client).not.toContain('"0.0.0-dev"');
  });
});
