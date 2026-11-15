import { describe, expect, it } from "vitest";

import { progressFromInstallerOutput } from "./UpdateService.js";

describe("progressFromInstallerOutput", () => {
  it("maps the installer's own step lines to progress", () => {
    expect(
      progressFromInstallerOutput("==> Detected platform: linux-x64"),
    ).toBe(8);
    expect(
      progressFromInstallerOutput("==> Using shell profile: /home/me/.zshrc"),
    ).toBe(12);
    expect(progressFromInstallerOutput("==> Latest release: v1.2.16")).toBe(50);
    expect(
      progressFromInstallerOutput(
        "==> Installing TNT CLI v1.2.16 from GitHub Releases...",
      ),
    ).toBe(62);
    expect(
      progressFromInstallerOutput(
        "==> TNT CLI v1.2.16 installed to /home/me/.tnt/cli",
      ),
    ).toBe(85);
    expect(progressFromInstallerOutput("Ready! Run: tnt --help")).toBe(100);
  });

  it("only moves forward across the whole script", () => {
    const lines = [
      "==> Detected platform: darwin-arm64",
      "==> Using shell profile: /Users/me/.zshrc",
      "==> Installing fnm (Fast Node Manager)...",
      "==> Node.js v24.0.0 installed",
      "==> Latest release: v1.2.16",
      "==> Installing TNT CLI v1.2.16 from GitHub Releases...",
      "==> TNT CLI v1.2.16 installed to /Users/me/.tnt/cli",
      "==> TNT CLI installation complete!",
      "Ready! Run: tnt --help",
    ];
    const percents = lines
      .map((line) => progressFromInstallerOutput(line))
      .filter((percent): percent is number => percent !== null);
    expect(percents).toHaveLength(lines.length);
    for (let index = 1; index < percents.length; index += 1) {
      expect(percents[index]).toBeGreaterThanOrEqual(percents[index - 1]!);
    }
    expect(percents.at(-1)).toBe(100);
  });

  it("treats unrelated output as noise", () => {
    expect(progressFromInstallerOutput("npm warn deprecated foo@1.0.0")).toBe(
      null,
    );
    expect(progressFromInstallerOutput("")).toBe(null);
  });
});
