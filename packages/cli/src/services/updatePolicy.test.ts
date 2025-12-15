import { describe, expect, it } from "vitest";

import { shouldCheckForUpdates } from "./UpdateService.js";

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
