import { describe, expect, test } from "vitest";

import { MockRemoteServer } from "./mockRemoteServer.js";

describe("MockRemoteServer", () => {
  test("should be defined", () => {
    expect(MockRemoteServer).toBeDefined();
  });
});
