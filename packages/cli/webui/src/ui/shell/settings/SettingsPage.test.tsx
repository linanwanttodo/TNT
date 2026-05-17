import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginsResponse } from "../../../api/client.js";

const fetchPlugins = vi.fn();
const reloadPlugins = vi.fn();
const setPluginEnabled = vi.fn();
const openPath = vi.fn();
const fetchModels = vi.fn();
const fetchState = vi.fn();
const chooseModel = vi.fn();

vi.mock("../../../api/client.js", () => ({
  fetchPlugins: (...args: unknown[]) => fetchPlugins(...args),
  reloadPlugins: (...args: unknown[]) => reloadPlugins(...args),
  setPluginEnabled: (...args: unknown[]) => setPluginEnabled(...args),
  openPath: (...args: unknown[]) => openPath(...args),
  fetchModels: (...args: unknown[]) => fetchModels(...args),
  fetchState: (...args: unknown[]) => fetchState(...args),
  chooseModel: (...args: unknown[]) => chooseModel(...args),
}));

import { SettingsPage } from "./SettingsPage.tsx";

const snapshot: PluginsResponse = {
  plugins: [
    {
      id: "alpha@acme",
      name: "alpha",
      version: "1.0.0",
      description: "Alpha plugin",
      path: "/plugins/alpha",
      enabled: true,
      skills: 1,
      commands: 1,
      agents: 1,
      mcpServers: 1,
    },
    {
      id: "beta@acme",
      name: "beta",
      description: "Beta plugin",
      path: "/plugins/beta",
      enabled: false,
      skills: 0,
      commands: 0,
      agents: 0,
      mcpServers: 0,
    },
  ],
  skills: [
    {
      name: "helper",
      description: "Helps out",
      plugin: "alpha",
      path: "/plugins/alpha/skills/helper/SKILL.md",
    },
  ],
  commands: [{ name: "alpha:run", description: "Run it", plugin: "alpha" }],
  agents: [{ name: "alpha:review", description: "Review it", plugin: "alpha" }],
  mcpServers: { docs: { url: "http://127.0.0.1:3000" } },
  disabledPlugins: ["beta"],
  unknownEnabledPlugins: [],
  marketplaces: ["acme"],
  settingsPath: "/project/.tnt/settings.json",
  pluginsDir: "/home/user/.tnt/plugins",
};

describe("SettingsPage", () => {
  beforeEach(() => {
    fetchPlugins.mockReset();
    reloadPlugins.mockReset();
    setPluginEnabled.mockReset();
    openPath.mockReset();
    fetchModels.mockReset();
    fetchState.mockReset();
    chooseModel.mockReset();
    fetchPlugins.mockResolvedValue(snapshot);
    reloadPlugins.mockResolvedValue(snapshot);
    openPath.mockResolvedValue(undefined);
    fetchModels.mockResolvedValue({
      available: true,
      models: [
        { index: 0, name: "fast-model", provider: "test", current: true },
        { index: 1, name: "smart-model", provider: "test", current: false },
      ],
      current: {
        index: 0,
        name: "fast-model",
        provider: "test",
        current: true,
      },
    });
    fetchState.mockResolvedValue({
      session: {
        sessionId: "session-1",
        title: "Test session",
        history: [],
        workspaceDirectory: "/work/project",
        chatModelTitle: "fast-model",
      },
      isProcessing: false,
      messageQueueLength: 0,
      pendingPermission: null,
      permissionMode: "default",
    });
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
    window.localStorage.removeItem("tnt-webui-theme");
  });

  it("shows the plugin inventory and enabled state", async () => {
    render(<SettingsPage section="plugins" />);

    expect(await screen.findByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("1 skills")).toBeTruthy();
    expect(screen.getByText("1 commands")).toBeTruthy();
    expect(screen.getByText("1 agents")).toBeTruthy();
  });

  it("filters the current section by search", async () => {
    render(<SettingsPage section="plugins" />);
    await screen.findByText("alpha");

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "beta" },
    });

    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("renders the section it is given", async () => {
    render(<SettingsPage section="skills" />);

    expect(await screen.findByText("helper")).toBeTruthy();
    expect(screen.getByText("Helps out")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("toggles a plugin and refreshes the listing", async () => {
    setPluginEnabled.mockResolvedValue({
      ...snapshot,
      plugins: snapshot.plugins.map((plugin) =>
        plugin.name === "alpha" ? { ...plugin, enabled: false } : plugin,
      ),
      disabledPlugins: ["alpha", "beta"],
    });
    render(<SettingsPage section="plugins" />);
    await screen.findByText("alpha");

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(setPluginEnabled).toHaveBeenCalledWith("alpha", false),
    );
    expect(
      await screen.findByText("alpha disabled for this project."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(reloadPlugins).toHaveBeenCalled());
  });

  it("shows the general settings facts", async () => {
    render(<SettingsPage section="general" />);

    expect(await screen.findByText("/work/project")).toBeTruthy();
    expect(screen.getByText("Test session")).toBeTruthy();
    expect(screen.getByText("default")).toBeTruthy();
    expect(screen.getByText("/project/.tnt/settings.json")).toBeTruthy();
  });

  it("lists models and switches the current one", async () => {
    chooseModel.mockResolvedValue({
      index: 1,
      name: "smart-model",
      provider: "test",
      current: true,
    });
    render(<SettingsPage section="models" />);

    expect(await screen.findByText("fast-model")).toBeTruthy();
    expect(screen.getByText("smart-model")).toBeTruthy();
    expect(screen.getByText("Current model")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(chooseModel).toHaveBeenCalledWith(1));
  });

  it("changes the theme from Appearance", async () => {
    render(<SettingsPage section="appearance" />);

    expect(screen.getByRole("button", { name: /Dark/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Light/ }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("tnt-webui-theme")).toBe("light");
  });
});
