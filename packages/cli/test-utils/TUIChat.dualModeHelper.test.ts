import { describe, expect, it } from "vitest";

import {
  renderInMode,
  testBothModes,
  testSingleMode,
} from "./TUIChat.dualModeHelper.js";

describe("TUIChat dual mode helper", () => {
  it("exports helper functions", () => {
    expect(testBothModes).toBeDefined();
    expect(renderInMode).toBeDefined();
    expect(testSingleMode).toBeDefined();
  });
});
