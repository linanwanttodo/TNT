import { describe, expect, it } from "vitest";

import { validateWebuiHost } from "./webui.js";

describe("validateWebuiHost", () => {
  it("accepts the loopback addresses", () => {
    expect(validateWebuiHost("127.0.0.1")).toEqual({ valid: true });
    expect(validateWebuiHost("localhost")).toEqual({ valid: true });
    expect(validateWebuiHost(undefined)).toEqual({ valid: true });
  });

  it("rejects a non-loopback bind with a reason", () => {
    const result = validateWebuiHost("0.0.0.0");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("loopback");
    }
  });

  it("rejects a LAN address", () => {
    expect(validateWebuiHost("192.168.1.10").valid).toBe(false);
  });
});
