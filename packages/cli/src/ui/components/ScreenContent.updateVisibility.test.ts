import { describe, expect, it } from "vitest";

import type { UpdateServiceState } from "../../services/types.js";
import { UpdateStatus } from "../../services/types.js";

import { hideScreenContent } from "./ScreenContent.js";

function updateState(patch: Partial<UpdateServiceState>): UpdateServiceState {
  return {
    autoUpdate: true,
    isAutoUpdate: false,
    status: UpdateStatus.IDLE,
    message: "",
    error: null,
    isUpdateAvailable: false,
    latestVersion: null,
    currentVersion: "1.0.6",
    ...patch,
  } as UpdateServiceState;
}

describe("hideScreenContent", () => {
  it("keeps the composer on screen while a version check is in flight", () => {
    expect(
      hideScreenContent(updateState({ status: UpdateStatus.CHECKING })),
    ).toBe(false);
    expect(
      hideScreenContent(
        updateState({
          status: UpdateStatus.CHECKING,
          isAutoUpdate: true,
        }),
      ),
    ).toBe(false);
  });

  it("hides the dock while the running copy is being replaced", () => {
    expect(
      hideScreenContent(
        updateState({ status: UpdateStatus.UPDATING, isAutoUpdate: true }),
      ),
    ).toBe(true);
    expect(
      hideScreenContent(
        updateState({ status: UpdateStatus.UPDATED, isAutoUpdate: true }),
      ),
    ).toBe(true);
  });

  it("does not hide for a manual update notification", () => {
    expect(
      hideScreenContent(
        updateState({ status: UpdateStatus.UPDATING, isAutoUpdate: false }),
      ),
    ).toBe(false);
  });
});
