import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

import { compareVersions, getLatestVersion, getVersion } from "./version.js";

const here = path.dirname(fileURLToPath(import.meta.url));

vi.mock("node:child_process", () => ({
  // A slow npm: the answer arrives long after a short timer would have fired,
  // which is what tells a blocking probe from an asynchronous one.
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (error: Error | null, stdout: string) => void,
  ) => {
    setTimeout(() => cb(null, "9.9.9\n"), 30);
  },
}));

describe("the version module", () => {
  it("answers a version without a network probe on import", () => {
    // `getLatestVersion()` runs `npm view` with a five-second budget. It used to be called
    // at module scope, so every importer - the LSP client included - paid for it.
    const source = readFileSync(path.join(here, "version.ts"), "utf-8");

    expect(source).not.toMatch(/^getLatestVersion\(\)/m);
  });

  it("probes npm without blocking the event loop", async () => {
    // The probe ran execFileSync inside the service-init phase, freezing the
    // whole process for as long as npm took and delaying first paint.
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
