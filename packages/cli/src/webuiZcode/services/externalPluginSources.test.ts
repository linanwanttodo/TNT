import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readExternalCatalogs } from "./externalPluginCatalogs.js";
import {
  entryFromCatalogPlugin,
  entryFromDirectoryListing,
  externalSourceToCatalog,
  uniqueEntries,
} from "./externalPluginSources.js";

describe("external plugin source adapters", () => {
  it("converts a Claude directory listing into a github source", () => {
    const entry = entryFromDirectoryListing({
      name: "Superpowers",
      summary: "Core skills library",
      release: { version: "6.4.2" },
      source: {
        type: "directory",
        repository: {
          url: "https://github.com/obra/superpowers",
        },
      },
    });

    expect(entry).toMatchObject({
      name: "superpowers",
      displayName: "Superpowers",
      description: "Core skills library",
      version: "6.4.2",
      source: { source: "github", repo: "obra/superpowers" },
    });
  });

  it("rejects non-https and non-github sources", () => {
    expect(
      entryFromDirectoryListing({
        name: "local",
        source: { repository: { url: "http://127.0.0.1/x/y" } },
      }),
    ).toBeNull();
    expect(
      entryFromDirectoryListing({
        name: "ftp",
        source: { repository: { url: "ftp://github.com/x/y" } },
      }),
    ).toBeNull();
  });

  it("keeps an official catalogue entry with its icon", () => {
    const entry = entryFromCatalogPlugin({
      name: "code-review",
      description: "Reviews changes",
      source: { repo: "anthropics/claude-plugins-official" },
      icon: "review.png",
    });

    expect(entry).toMatchObject({
      name: "code-review",
      icon: "review.png",
      publisherType: "official",
      source: { source: "github", repo: "anthropics/claude-plugins-official" },
    });
  });

  it("deduplicates by name and builds a shell catalogue", () => {
    const entries = uniqueEntries([
      entryFromCatalogPlugin({ name: "a", source: "https://github.com/x/a" }),
      entryFromCatalogPlugin({ name: "a", source: "https://github.com/x/b" }),
      entryFromCatalogPlugin({ name: "b", source: "https://github.com/x/b" }),
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(["a", "b"]);

    const catalog = externalSourceToCatalog({
      name: "claude-plugins-official",
      description: "official",
      entries,
      publisherType: "official",
    });
    expect(catalog?.manifest?.plugins).toHaveLength(2);
    expect(catalog?.record.installLocation).toBe("claude-plugins-official");
  });

  it("reads a local Claude cache layout into catalogues", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-ext-plugins-"));
    try {
      fs.writeFileSync(
        path.join(root, "plugin-catalog-cache.json"),
        JSON.stringify({
          catalog: {
            plugins: {
              alpha: {
                name: "alpha",
                description: "official plugin",
                source: { repo: "anthropics/claude-plugins-official" },
              },
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(root, "plugin-directory-cache-v2.json"),
        JSON.stringify({
          listings: [
            {
              name: "Community Tool",
              summary: "community plugin",
              release: { version: "2.0.0" },
              source: {
                type: "directory",
                repository: { url: "https://github.com/org/community-tool" },
              },
            },
          ],
        }),
      );
      const catalogs = readExternalCatalogs(root);
      const names = catalogs.map((catalog) => catalog.name);
      expect(names).toContain("claude-plugins-official");
      expect(names).toContain("claude-plugin-directory");
      const directory = catalogs.find(
        (catalog) => catalog.name === "claude-plugin-directory",
      );
      expect(directory?.manifest?.plugins).toHaveLength(1);
      expect(directory?.manifest?.plugins[0]).toMatchObject({
        name: "community-tool",
        source: { source: "github", repo: "org/community-tool" },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
