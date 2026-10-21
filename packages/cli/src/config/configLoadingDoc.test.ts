import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/config-loading.md` used to describe the Continue platform flow: a saved
 * config URI, a `tnt/default-cli-config` fetched from the API, and assistant
 * slugs accepted by `--config`. The loader now reads local files only, so the
 * page has to stop promising a network fallback that no longer exists.
 *
 * The claims are read from the loader itself: no slug case, no saved URI, and
 * no `getAssistant` call in that file.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "config-loading.md");
const LOADER = path.join(here, "loader.ts");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

describe("spec/config-loading.md agrees with the loader", () => {
  const doc = read(DOC);
  const loader = read(LOADER);

  it("reads a page and a loader that exist", () => {
    expect(doc.length).toBeGreaterThan(500);
    expect(loader).toContain("determineConfigSource");
  });

  it("has no slug or network default left in the loader", () => {
    expect(loader).not.toMatch(/saved-uri|remote-default-config/);
    expect(loader).not.toMatch(/getAssistant\(/);
    expect(loader).toContain('t("config.slugRemoved")');
  });

  it("states the local-only rule and the slug refusal", () => {
    expect(doc).toMatch(/local files only/i);
    expect(doc).toMatch(/slug/i);
    expect(doc).toMatch(/refused/i);
  });

  it("points permissions and MCP at their own files", () => {
    expect(/settings\.json/.test(doc)).toBe(
      /settings\.json/.test(loader + doc),
    );
    expect(doc).toContain("mcp.json");
  });
});
