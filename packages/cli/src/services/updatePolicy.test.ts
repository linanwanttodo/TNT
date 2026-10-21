import { describe, expect, it } from "vitest";

import { shouldAutoUpdate, shouldCheckForUpdates } from "./UpdateService.js";

describe("whether the CLI asks npm for updates", () => {
  it("never asks from a dev build", () => {
    expect(shouldCheckForUpdates("0.0.0-dev")).toBe(false);
    expect(shouldCheckForUpdates("0.1.0-dev")).toBe(false);
  });

  it("asks from a released version, and from an unresolvable one", () => {
    expect(shouldCheckForUpdates("0.1.0")).toBe(true);
    // `unknown` cannot be compared, so compareVersions answers "same"; asking is harmless
    // and keeps the pre-existing behaviour.
    expect(shouldCheckForUpdates("unknown")).toBe(true);
  });
});

describe("whether the CLI replaces itself", () => {
  const base = {
    autoUpdate: true,
    isUpdateAvailable: true,
    status: "idle",
    alreadyAutoUpdated: false,
  };

  it("only when every gate allows it", () => {
    expect(shouldAutoUpdate(base)).toBe(true);
  });

  it("not when the user turned auto-update off", () => {
    expect(shouldAutoUpdate({ ...base, autoUpdate: false })).toBe(false);
  });

  it("not when there is nothing to install, or an update is already running", () => {
    expect(shouldAutoUpdate({ ...base, isUpdateAvailable: false })).toBe(false);
    expect(shouldAutoUpdate({ ...base, status: "updating" })).toBe(false);
  });

  it("not a second time in the same process", () => {
    expect(shouldAutoUpdate({ ...base, alreadyAutoUpdated: true })).toBe(false);
  });
});
