import { describe, expect, it } from "vitest";

import { webuiDistCandidates } from "./webuiDist.js";

describe("webui dist candidates", () => {
  it("prefers the zcode-ui web build before the legacy tnt-webui install", () => {
    const [first, ...rest] = webuiDistCandidates(
      "/repo/packages/cli/dist/services",
      "/repo",
    );
    expect(first).toContain("zcode-ui");
    expect(
      rest.some((p) => p.includes("node_modules") && p.includes("tnt-webui")),
    ).toBe(true);
  });
});
