import { describe, expect, test } from "vitest";

import { createProps, mockAssistant } from "./TUIChat.setup.js";

describe("TUIChat setup", () => {
  test("setup should export required functions", () => {
    expect(createProps).toBeDefined();
    expect(mockAssistant).toBeDefined();
  });
});
