import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { compareVersions, getVersion } from "./version.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("the version module", () => {
  it("answers a version without a network probe on import", () => {
    // `getLatestVersion()` runs `npm view` with a five-second budget. It used to be called
    // at module scope, so every importer - the LSP client included - paid for it.
    const source = readFileSync(path.join(here, "version.ts"), "utf-8");

    expect(source).not.toMatch(/^getLatestVersion\(\)/m);
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
