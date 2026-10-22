import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/mcp.md` is where an author learns which files are read, whether a
 * project file can override a user server, and what `/mcp` actually shows.
 * Each claim is read back from the loader, the service, the transports and the
 * selector, so a change to any of them has to update the page.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(packageRoot, ...segments), "utf-8");
}

const doc = read("spec", "mcp.md");
const config = read("src", "config", "mcpConfig.ts");
const service = read("src", "services", "MCPService.ts");
const transports = read("src", "services", "mcpTransports.ts");
const selector = read("src", "ui", "MCPSelector.tsx");
const i18n = read("src", "i18n", "index.ts");

describe("spec/mcp.md agrees with the implementation", () => {
  it("reads the page and every layer it names", () => {
    expect(doc.length).toBeGreaterThan(800);
    expect(config).toContain("mcpJsonPaths");
    expect(service).toContain("configuredServers");
    expect(selector).toContain("MCPSelector");
  });

  it("matches the file order and the trust gate", () => {
    expect(config).toContain('path.join(env.continueHome, "mcp.json")');
    expect(config).toMatch(/if \(isProjectTrusted\(cwd\)\)/);
    expect(config).toContain('path.join(cwd, ".tnt", "mcp.json")');
    expect(config).toContain('path.join(cwd, ".mcp.json")');
    expect(doc).toMatch(/only after\s+the project is trusted/);
    expect(doc).toMatch(/also trust-gated/);
  });

  it("matches the per-name merge where the later file wins", () => {
    expect(config).toContain("merged.set(name, {");
    expect(doc).toMatch(/servers merge by name/);
    expect(doc).toMatch(/later file\s+replaces an earlier server/);
    expect(doc).toMatch(/root `\.mcp\.json` therefore wins/);
  });

  it("keeps the legacy config.yaml path and its warning", () => {
    expect(service).toContain("warnLegacyMcpConfigOnce");
    expect(service).toContain('t("mcp.legacyConfigServers")');
    expect(i18n).toContain('"mcp.legacyConfigServers"');
    expect(doc).toMatch(/deprecation\s+warning/);
  });

  it("matches the secret handling on both paths", () => {
    expect(service).toContain("getTemplateVariables");
    expect(service).toContain("secrets.");
    expect(service).toContain("if (this.isHeadless) {");
    expect(transports).toMatch(/Object\.entries\(process\.env\)/);
    expect(doc).toMatch(/connected exactly as written/);
    expect(doc).toMatch(/headless mode it fails to start/);
    expect(doc).toMatch(/passes\s+its own environment through/);
    expect(doc).toMatch(/expanded during config unrolling/);
  });

  it("matches the connection lifecycle the service implements", () => {
    expect(service).toContain("Promise.all(connectionPromises ?? [])");
    for (const status of ["idle", "connecting", "connected", "error"]) {
      expect(service).toContain(`"${status}"`);
    }
    expect(service).toContain("shutdownConnections");
    expect(service).toContain("logger.");
    expect(doc).toMatch(/never blocks service initialization/);
    expect(doc).toMatch(/`idle`, `connecting`, `connected` or `error`/);
    expect(doc).toMatch(/winston logger, never `console\.log`/);
  });

  it("describes the menu the selector builds", () => {
    expect(selector).toContain('t("mcp.restartAll")');
    expect(selector).toContain('t("mcp.stopAll")');
    expect(selector).toContain('t("mcp.explore")');
    expect(selector).toContain('t("mcp.restartOne")');
    expect(selector).toContain('t("mcp.stopOne")');
    expect(selector).toContain("connections.length > 0");
    expect(selector).toContain('serverInfo.status === "connected"');
    expect(selector).toContain('t("mcp.statusWithWarnings")');

    for (const key of [
      '"mcp.restartAll"',
      '"mcp.stopAll"',
      '"mcp.explore"',
      '"mcp.backLabel"',
    ]) {
      expect(i18n).toContain(key);
    }

    expect(doc).toContain("Explore MCP Servers");
    expect(doc).toContain("Stop server");
    expect(doc).toMatch(/only while the\s+server is connected/);
    expect(doc).not.toContain("View servers");
    expect(doc).not.toContain("No Servers");
  });

  it("keeps the status colours the selector assigns", () => {
    expect(selector).toContain('icon = "🟢"');
    expect(selector).toContain('color = "green"');
    expect(selector).toContain('icon = "🟡"');
    expect(selector).toContain('color = "yellow"');
    expect(selector).toContain('icon = "🔴"');
    expect(selector).toContain('color = "red"');

    expect(doc).toMatch(/green for a connected server/);
    expect(doc).toMatch(/yellow while connecting/);
    expect(doc).toMatch(/red for an error/);
    expect(doc).toMatch(/gray for idle/);
  });

  it("documents the market where it is implemented", () => {
    const market = read("src", "mcp", "marketplace.ts");
    expect(/MCP_MARKETPLACE/.test(doc)).toBe(
      /export const MCP_MARKETPLACE/.test(market),
    );
    expect(/mcpServers/.test(doc)).toBe(true);
    expect(/env/.test(doc)).toBe(/envKeys/.test(market));
  });
});
