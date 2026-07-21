import { describe, expect, it } from "vitest";

import type { Catalog } from "./pluginMapping.js";

import { legacyAvailableSummary } from "./pluginMapping.js";

describe("marketplace storefront fields", () => {
  const catalog = {
    name: "official",
    record: {
      source: { source: "directory", path: "/tmp/official" },
      installLocation: "/tmp/official/.tnt-plugin/marketplace.json",
      lastUpdated: "2026-01-01",
    },
  } as unknown as Catalog;

  it("passes the catalogue icon and display name to the store card", () => {
    const summary = legacyAvailableSummary(
      catalog,
      {
        name: "review",
        source: { source: "github", repo: "acme/review" },
        icon: "https://example.com/review.png",
        displayName: "Code Review",
        category: "productivity",
      },
      new Set(),
    );
    expect(summary.listing).toMatchObject({
      icon: "https://example.com/review.png",
      displayName: "Code Review",
      category: "productivity",
    });
  });

  it("omits the listing rather than sending an insecure icon", () => {
    const summary = legacyAvailableSummary(
      catalog,
      {
        name: "local",
        source: "local",
        icon: "/tmp/icon.png",
      },
      new Set(),
    );
    expect(summary.listing).toBeUndefined();
  });
});
