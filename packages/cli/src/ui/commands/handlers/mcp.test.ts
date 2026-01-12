import { describe, expect, it } from "vitest";

import { handleMcp } from "./mcp.js";

/**
 * `/mcp` is a parent now: the market child opens the catalog, everything else
 * (including no argument at all) keeps opening the configured-server list.
 */
describe("handleMcp", () => {
  it("opens the configured-server list by default", async () => {
    await expect(handleMcp([])).resolves.toEqual({ openMcpSelector: true });
    await expect(handleMcp(["list"])).resolves.toEqual({
      openMcpSelector: true,
    });
  });

  it("opens the marketplace for the market child", async () => {
    await expect(handleMcp(["market"])).resolves.toEqual({
      openMcpMarketplace: true,
    });
    await expect(handleMcp(["MARKET"])).resolves.toEqual({
      openMcpMarketplace: true,
    });
  });
});
