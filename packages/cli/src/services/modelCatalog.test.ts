import { beforeEach, describe, expect, it, vi } from "vitest";

const modelService = {
  getAvailableChatModels: vi.fn(),
  getCurrentModelIndex: vi.fn(),
  switchModel: vi.fn(),
  getModelInfo: vi.fn(),
  getState: vi.fn(),
};
const configService = {
  getState: vi.fn(() => ({ configPath: "/tmp/config.yaml" })),
};
const containerSet = vi.fn();

vi.mock("./index.js", () => ({
  SERVICE_NAMES: { MODEL: "model", CONFIG: "config" },
  serviceContainer: { set: (...args: unknown[]) => containerSet(...args) },
  services: {
    get model() {
      return modelService;
    },
    get config() {
      return configService;
    },
  },
}));

vi.mock("../config/modelSelection.js", () => ({
  defaultConfigPath: () => "/tmp/config.yaml",
  writeSelectedModelName: vi.fn(),
}));

import { writeSelectedModelName } from "../config/modelSelection.js";

import { listChatModels, switchChatModel } from "./modelCatalog.js";

describe("the model list the web UI shows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelService.getAvailableChatModels.mockReturnValue([
      { provider: "deepseek", name: "Deepseek-V4.1-Flash", index: 0 },
      { provider: "openai", name: "gpt-5.2", index: 1 },
    ]);
    modelService.getCurrentModelIndex.mockReturnValue(1);
  });

  it("marks the model the process is on", () => {
    expect(listChatModels()).toEqual([
      {
        index: 0,
        name: "Deepseek-V4.1-Flash",
        provider: "deepseek",
        current: false,
      },
      { index: 1, name: "gpt-5.2", provider: "openai", current: true },
    ]);
  });

  it("answers with nothing when no models are configured", () => {
    modelService.getAvailableChatModels.mockReturnValue([]);
    modelService.getCurrentModelIndex.mockReturnValue(-1);
    expect(listChatModels()).toEqual([]);
  });
});

describe("switching the model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelService.getAvailableChatModels.mockReturnValue([
      { provider: "deepseek", name: "Deepseek-V4.1-Flash", index: 0 },
      { provider: "openai", name: "gpt-5.2", index: 1 },
    ]);
    modelService.getCurrentModelIndex.mockReturnValue(0);
    modelService.switchModel.mockResolvedValue({
      llmApi: {},
      model: {},
      assistant: {},
    });
    modelService.getModelInfo.mockReturnValue({
      provider: "openai",
      name: "gpt-5.2",
    });
  });

  it("applies the switch the way the /model screen does", async () => {
    const chosen = await switchChatModel(1);

    expect(modelService.switchModel).toHaveBeenCalledWith(1);
    expect(containerSet).toHaveBeenCalled();
    expect(writeSelectedModelName).toHaveBeenCalledWith(
      "gpt-5.2",
      "/tmp/config.yaml",
    );
    expect(chosen).toEqual({
      index: 1,
      name: "gpt-5.2",
      provider: "openai",
      current: true,
    });
  });

  it("refuses an index outside the list before touching the model", async () => {
    await expect(switchChatModel(7)).rejects.toThrow(/7/);
    expect(modelService.switchModel).not.toHaveBeenCalled();
  });

  it("still switches when the selection cannot be written down", async () => {
    vi.mocked(writeSelectedModelName).mockImplementationOnce(() => {
      throw new Error("read-only config");
    });

    await expect(switchChatModel(1)).resolves.toMatchObject({
      name: "gpt-5.2",
    });
  });
});
