import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { invalidatePluginCache } from "../../plugins/loader.js";

import {
  createZcodePluginServices,
  type ZcodePluginServices,
} from "./plugins.js";

const UNAVAILABLE_PLUGIN_MANAGEMENT = "ZCODE_UNAVAILABLE:plugin-management";

describe("zcode plugin services", () => {
  let root: string;
  let pluginsDir: string;
  let projectDir: string;
  let marketplaceDir: string;
  let services: ZcodePluginServices;
  let previousPluginsDir: string | undefined;
  let previousClaudePluginsDir: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-zcode-plugins-"));
    pluginsDir = path.join(root, "plugins");
    projectDir = path.join(root, "project");
    marketplaceDir = path.join(root, "local-market");
    fs.mkdirSync(projectDir, { recursive: true });
    writeMarketplace(marketplaceDir, [
      {
        name: "alpha",
        source: "./plugins/alpha",
        version: "1.0.0",
        description: "Alpha plugin",
        category: "utilities",
        author: { name: "Acme" },
      },
    ]);
    writePluginSource(marketplaceDir, "alpha", "1.0.0");

    previousPluginsDir = process.env.TNT_PLUGINS_DIR;
    previousClaudePluginsDir = process.env.TNT_CLAUDE_PLUGINS_DIR;
    process.env.TNT_PLUGINS_DIR = pluginsDir;
    process.env.TNT_CLAUDE_PLUGINS_DIR = path.join(root, "claude-plugins");
    invalidatePluginCache();
    services = createZcodePluginServices();
  });

  afterEach(() => {
    services.dispose();
    invalidatePluginCache();
    if (previousPluginsDir === undefined) {
      delete process.env.TNT_PLUGINS_DIR;
    } else {
      process.env.TNT_PLUGINS_DIR = previousPluginsDir;
    }
    if (previousClaudePluginsDir === undefined) {
      delete process.env.TNT_CLAUDE_PLUGINS_DIR;
    } else {
      process.env.TNT_CLAUDE_PLUGINS_DIR = previousClaudePluginsDir;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeMarketplace(
    directory: string,
    plugins: Array<Record<string, unknown>>,
  ): void {
    const manifest = path.join(directory, ".claude-plugin", "marketplace.json");
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        name: "local-market",
        owner: { name: "Fixture" },
        plugins,
      }),
    );
  }

  function writePluginSource(
    directory: string,
    name: string,
    version: string,
  ): void {
    const pluginRoot = path.join(directory, "plugins", name);
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name,
        version,
        description: `${name} plugin`,
        mcpServers: { docs: { command: "node", args: ["server.js"] } },
      }),
    );
    fs.mkdirSync(path.join(pluginRoot, "skills", "helper"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(pluginRoot, "skills", "helper", "SKILL.md"),
      "name: helper\ndescription: Helps out\n",
    );
    fs.mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "commands", "run.md"), "Run it.");
    fs.mkdirSync(path.join(pluginRoot, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "agents", "review.md"),
      "Review it.",
    );
  }

  async function addMarketplace(): Promise<void> {
    await services.pluginManagementService.addPluginMarketplace({
      workspacePath: projectDir,
      source: `directory:${marketplaceDir}`,
    });
  }

  async function installAlpha(): Promise<string> {
    const result = await services.pluginManagementService.installPlugin({
      workspacePath: projectDir,
      pluginName: "alpha",
      marketplace: "local-market",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.installedPlugins).toHaveLength(1);
    const installPath = result.installedPlugins[0]?.installPath;
    expect(installPath).toBeTruthy();
    return installPath as string;
  }

  it("registers a local marketplace and lists its catalogue", async () => {
    const before = await services.pluginManagementService.listPlugins({
      workspacePath: projectDir,
    });
    expect(before.plugins).toEqual([]);

    await addMarketplace();

    const overview = await services.pluginManagementService.getPluginsOverview({
      workspacePath: projectDir,
    });
    expect(overview.marketplaces).toHaveLength(1);
    expect(overview.marketplaces[0]).toMatchObject({
      id: "local-market",
      name: "local-market",
      pluginCount: 1,
    });
    expect(overview.availablePlugins).toEqual([
      expect.objectContaining({
        id: "alpha@local-market",
        name: "alpha",
        marketplace: "local-market",
        version: "1.0.0",
        installed: false,
        listing: expect.objectContaining({
          category: "utilities",
          author: "Acme",
        }),
      }),
    ]);
    expect(overview.capability).toEqual({ supported: true });
  });

  it("installs from a local marketplace and lists the installed plugin", async () => {
    await addMarketplace();
    const installPath = await installAlpha();
    expect(
      fs.existsSync(path.join(installPath, ".claude-plugin", "plugin.json")),
    ).toBe(true);

    const list = await services.pluginManagementService.listPlugins({
      workspacePath: projectDir,
    });
    expect(list.diagnostics).toEqual([]);
    const alpha = list.plugins.find(
      (plugin) => plugin.id === "alpha@local-market",
    );
    expect(alpha).toMatchObject({
      name: "alpha",
      marketplace: "local-market",
      version: "1.0.0",
      enabled: true,
      source: "cache",
      skillCount: 1,
      skillRootCount: 1,
      commandRootCount: 1,
      declaredMcpServerNames: ["docs"],
      mcpServerNames: ["plugin:alpha:docs"],
      rootPath: installPath,
    });
    expect(alpha?.components?.map((group) => group.kind).sort()).toEqual([
      "agent",
      "command",
      "mcp",
      "skill",
    ]);

    const overview = await services.pluginManagementService.getPluginsOverview({
      workspacePath: projectDir,
    });
    const installed = overview.installedPlugins.find(
      (plugin) => plugin.id === "alpha@local-market",
    );
    expect(installed).toMatchObject({
      name: "alpha",
      version: "1.0.0",
      scope: "user",
      enabled: true,
      installPath,
      updateStatus: "none",
      latestVersion: "1.0.0",
    });
    expect(installed?.componentTypes).toEqual(
      expect.arrayContaining(["agent", "command", "skill", "mcp"]),
    );
  });

  it("persists enable and disable and reflects it in the next list", async () => {
    await addMarketplace();
    await installAlpha();

    const disabled = await services.pluginManagementService.setPluginEnabled({
      workspacePath: projectDir,
      pluginId: "alpha@local-market",
      enabled: false,
    });
    expect(disabled.enabled).toBe(false);
    expect(disabled.plugin.enabled).toBe(false);

    const settings = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".tnt", "settings.json"), "utf8"),
    ) as { enabledPlugins: string[] };
    expect(settings.enabledPlugins).toEqual([]);

    const list = await services.pluginManagementService.listPlugins({
      workspacePath: projectDir,
    });
    expect(
      list.plugins.find((plugin) => plugin.id === "alpha@local-market"),
    ).toMatchObject({ enabled: false, mcpServerNames: [] });

    const enabled = await services.pluginManagementService.setPluginEnabled({
      workspacePath: projectDir,
      pluginId: "alpha@local-market",
      enabled: true,
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.plugin.enabled).toBe(true);
  });

  it("uninstalls a plugin and removes its cached copy", async () => {
    await addMarketplace();
    const installPath = await installAlpha();

    const result = await services.pluginManagementService.uninstallPlugin({
      workspacePath: projectDir,
      pluginId: "alpha@local-market",
    });
    expect(result.removedPlugin).toMatchObject({ id: "alpha@local-market" });
    expect(fs.existsSync(installPath)).toBe(false);

    const list = await services.pluginManagementService.listPlugins({
      workspacePath: projectDir,
    });
    expect(list.plugins).toEqual([]);
    const overview = await services.pluginManagementService.getPluginsOverview({
      workspacePath: projectDir,
    });
    expect(overview.installedPlugins).toEqual([]);
    expect(overview.availablePlugins[0]).toMatchObject({ installed: false });
  });

  it("restores a plugin from the catalog that still lists it", async () => {
    await addMarketplace();
    await installAlpha();
    await services.pluginManagementService.uninstallPlugin({
      workspacePath: projectDir,
      pluginId: "alpha@local-market",
    });

    const restored =
      await services.pluginManagementService.restoreBuiltinPlugin({
        workspacePath: projectDir,
        pluginId: "alpha@local-market",
      });
    expect(restored).toEqual({
      pluginId: "alpha@local-market",
      diagnostics: [],
    });

    const list = await services.pluginManagementService.listPlugins({
      workspacePath: projectDir,
    });
    expect(
      list.plugins.find((plugin) => plugin.id === "alpha@local-market"),
    ).toMatchObject({ enabled: true, version: "1.0.0" });
  });

  it("updates an installed plugin when the catalogue version changes", async () => {
    await addMarketplace();
    await installAlpha();

    writeMarketplace(marketplaceDir, [
      {
        name: "alpha",
        source: "./plugins/alpha",
        version: "2.0.0",
        description: "Alpha plugin",
      },
    ]);
    writePluginSource(marketplaceDir, "alpha", "2.0.0");

    const beforeUpdate =
      await services.pluginManagementService.getPluginsOverview({
        workspacePath: projectDir,
      });
    expect(
      beforeUpdate.installedPlugins.find(
        (plugin) => plugin.id === "alpha@local-market",
      ),
    ).toMatchObject({
      updateStatus: "update-available",
      latestVersion: "2.0.0",
    });

    const updated = await services.pluginManagementService.updatePlugin({
      workspacePath: projectDir,
      pluginId: "alpha@local-market",
    });
    expect(updated.diagnostics).toEqual([]);
    expect(updated.installedPlugins[0]).toMatchObject({
      id: "alpha@local-market",
      version: "2.0.0",
    });

    const list = await services.pluginManagementService.listPlugins({
      workspacePath: projectDir,
    });
    expect(
      list.plugins.find((plugin) => plugin.id === "alpha@local-market")
        ?.version,
    ).toBe("2.0.0");
  });

  it("emits progress on the dynamic event member the contract declares", async () => {
    await addMarketplace();
    const seen: Array<{ operationId: string; state: string }> = [];
    const subscription =
      services.pluginManagementService.onDynamicPluginOperationProgress("op-1")(
        (event) => seen.push(event),
      );

    await services.pluginManagementService.updatePluginMarketplace({
      workspacePath: projectDir,
      marketplace: "local-market",
      operationId: "op-1",
    });
    subscription.dispose();

    expect(seen).toEqual([{ operationId: "op-1", state: "refreshing" }]);
  });

  it("rejects marketplace sources TNT cannot serve instead of faking success", async () => {
    await expect(
      services.pluginManagementService.addPluginMarketplace({
        workspacePath: projectDir,
        source: "pip:some-package",
      }),
    ).rejects.toThrow(UNAVAILABLE_PLUGIN_MANAGEMENT);

    writeMarketplace(marketplaceDir, [
      { name: "piponly", source: { source: "pip", package: "x" } },
    ]);
    await services.pluginManagementService.addPluginMarketplace({
      workspacePath: projectDir,
      source: `directory:${marketplaceDir}`,
    });
    await expect(
      services.pluginManagementService.installPlugin({
        workspacePath: projectDir,
        pluginName: "piponly",
        marketplace: "local-market",
      }),
    ).rejects.toThrow(UNAVAILABLE_PLUGIN_MANAGEMENT);
  });

  it("describes an installed plugin's components", async () => {
    await addMarketplace();
    await installAlpha();

    const described = await services.pluginManagementService.describePlugin({
      workspacePath: projectDir,
      marketplace: "local-market",
      pluginName: "alpha",
    });
    expect(described.components.map((group) => group.kind).sort()).toEqual([
      "agent",
      "command",
      "mcp",
      "skill",
    ]);
    expect(described.metadata).toMatchObject({ version: "1.0.0" });
    expect(described.diagnostics).toEqual([]);
  });

  it("serves the legacy IPluginsService overview and mutations", async () => {
    const legacy = services.pluginsService;
    await legacy.addMarketplace({
      workspacePath: projectDir,
      source: `directory:${marketplaceDir}`,
    });

    let overview = await legacy.getOverview({ workspacePath: projectDir });
    expect(overview.capability).toEqual({ supported: true });
    expect(overview.marketplaces).toHaveLength(1);
    expect(overview.availablePlugins[0]).toMatchObject({
      id: "alpha@local-market",
      installed: false,
    });

    await legacy.installPlugin({
      workspacePath: projectDir,
      pluginName: "alpha",
      marketplace: "local-market",
    });
    overview = await legacy.getOverview({ workspacePath: projectDir });
    expect(overview.installedPlugins).toEqual([
      expect.objectContaining({
        id: "alpha@local-market",
        scope: "user",
        enabled: true,
      }),
    ]);

    await legacy.setPluginEnabled({
      workspacePath: projectDir,
      pluginName: "alpha",
      marketplace: "local-market",
      enabled: false,
    });
    overview = await legacy.getOverview({ workspacePath: projectDir });
    expect(overview.installedPlugins[0]?.enabled).toBe(false);

    await legacy.uninstallPlugin({
      workspacePath: projectDir,
      pluginName: "alpha",
      marketplace: "local-market",
    });
    overview = await legacy.getOverview({ workspacePath: projectDir });
    expect(overview.installedPlugins).toEqual([]);
  });
});
