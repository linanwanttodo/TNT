import { describe, expect, it } from "vitest";

import { authMethodsFor, TNT_SETUP_AUTH_METHOD_ID } from "./auth.js";

describe("ACP auth methods", () => {
  it("offers the terminal setup only to a client that can run it", () => {
    expect(authMethodsFor({})).toEqual([]);
    expect(authMethodsFor({ auth: { terminal: false } })).toEqual([]);

    const methods = authMethodsFor({ auth: { terminal: true } });
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({
      id: TNT_SETUP_AUTH_METHOD_ID,
      type: "terminal",
      args: [],
    });
  });
});
