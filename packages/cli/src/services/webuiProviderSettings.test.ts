import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  createWebUiProviderSettingsService,
  type ProviderSettingsIO,
  type RawModelEntry,
} from "./webuiProviderSettings.js";

let dir: string;
let configPath: string;
let stateFile: string;

function writeConfig(models: RawModelEntry[]): void {
  fs.writeFileSync(
    configPath,
    stringifyYaml({
      name: "Test Config",
      version: "1.0.0",
      schema: "v1",
      // A sibling key must survive every models rewrite.
      rules: [{ name: "keep me", rule: "stay" }],
      models,
    }),
  );
}

function readModels(): RawModelEntry[] {
  const document = parseYaml(fs.readFileSync(configPath, "utf8")) as {
    models?: RawModelEntry[];
  };
  return document.models ?? [];
}

function readDocument(): Record<string, unknown> {
  return parseYaml(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
}

function io(): ProviderSettingsIO {
  const read = () => Promise.resolve({ configPath, models: readModels() });
  return {
    read,
    async writeModels(update) {
      const document = readDocument();
      document.models = update(readModels());
      fs.writeFileSync(configPath, stringifyYaml(document));
    },
    async reload() {},
  };
}

function service() {
  return createWebUiProviderSettingsService({ io: io(), stateFile });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-provider-settings-"));
  configPath = path.join(dir, "config.yaml");
  stateFile = path.join(dir, "webui-providers.json");
  writeConfig([
    {
      name: "local",
      provider: "openai",
      model: "auto/deepseek-v4.1-flash",
      apiKey: "magpie",
      apiBase: "http://127.0.0.1:3425/v1",
      roles: ["chat"],
      contextLength: 200_000,
    },
    {
      name: "sonnet",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      apiKey: "sk-test",
      roles: ["chat"],
    },
  ]);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("provider settings view", () => {
  it("projects the model list into personal providers with real config", async () => {
    const view = await service().getView();

    expect(view.providers.map((provider) => provider.providerId)).toEqual([
      "openai",
      "anthropic",
    ]);
    const openai = view.providers[0]!;
    expect(openai.effectiveConfig.group).toBe("standard-personal");
    expect(openai.effectiveConfig.api).toEqual({
      type: "openai-chat-completions",
      baseUrl: "http://127.0.0.1:3425/v1",
    });
    expect(openai.effectiveConfig.access).toMatchObject({
      type: "api-key",
      apiKey: "magpie",
    });
    expect(openai.models.map((model) => model.modelId)).toEqual(["local"]);
    expect(
      (
        openai.models[0]!.effectiveConfig as {
          properties?: { contextWindow?: number };
        }
      ).properties?.contextWindow,
    ).toBe(200_000);
    // The template picker must offer the families TNT speaks.
    expect(
      view.providerTemplates.map((template) => template.templateId),
    ).toEqual(
      expect.arrayContaining(["openai", "anthropic", "gemini", "ollama"]),
    );
  });
});

describe("provider settings mutations", () => {
  it("creates a provider, carries its endpoint into the first model, and rewrites the file", async () => {
    const settings = service();

    const created = await settings.createPersonalProvider({
      providerName: "My GitHub Models",
    });
    expect(
      created.view.providers.map((provider) => provider.providerId),
    ).toContain(created.providerId);

    await settings.savePersonalProviderOverlay(created.providerId, {
      group: "standard-personal",
      api: {
        type: "openai-chat-completions",
        baseUrl: "https://models.example/v1",
      },
      access: { type: "api-key", apiKey: "ghs-secret" },
    });

    const view = await settings.addPersonalModel(
      created.providerId,
      "gpt-4o-mini",
      {
        properties: {
          contextWindow: 128_000,
          inputFormat: { supportsText: true },
          outputFormat: { supportsText: true },
          supportsToolCall: true,
          supportsJsonSchemaOutput: false,
          supportsNativeWebSearch: false,
          supportsMidConversationSystem: false,
          requiresMfjsToolSchema: false,
        },
        optionSpecs: {
          maxOutputTokens: {
            max: 16_384,
            map: "{'max_tokens': maxOutputTokens}",
          },
        },
      },
    );

    const entry = readModels().find((model) => model.name === "gpt-4o-mini");
    expect(entry).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      apiBase: "https://models.example/v1",
      apiKey: "ghs-secret",
      roles: ["chat"],
      contextLength: 128_000,
      defaultCompletionOptions: { maxTokens: 16_384 },
    });
    // The draft provider is gone; the model backs the openai family now.
    expect(view.providers.map((provider) => provider.providerId)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(
      view.providers
        .find((provider) => provider.providerId === "openai")
        ?.models.map((model) => model.modelId),
    ).toEqual(["local", "gpt-4o-mini"]);
    // Unrelated config keys are preserved.
    expect(readDocument().rules).toEqual([{ name: "keep me", rule: "stay" }]);
  });

  it("updates every model of a provider when its overlay changes", async () => {
    const settings = service();

    await settings.savePersonalProviderOverlay("openai", {
      api: { type: "openai-responses", baseUrl: "https://api.example/v1" },
      access: { type: "api-key", apiKey: "next-key" },
      group: "standard-personal",
    });

    const entry = readModels().find((model) => model.name === "local");
    expect(entry).toMatchObject({
      apiBase: "https://api.example/v1",
      apiKey: "next-key",
      useResponsesApi: true,
    });
    // Other families are untouched.
    expect(
      readModels().find((model) => model.name === "sonnet")?.apiBase,
    ).toBeUndefined();
  });

  it("disables and re-enables a model through its chat role", async () => {
    const settings = service();

    let view = await settings.setPersonalModelEnabled("openai", "local", false);
    expect(readModels().find((model) => model.name === "local")?.roles).toEqual(
      [],
    );
    expect(
      view.providers[0]?.models.find((model) => model.modelId === "local")
        ?.enabled,
    ).toBe(false);

    view = await settings.setPersonalModelEnabled("openai", "local", true);
    expect(readModels().find((model) => model.name === "local")?.roles).toEqual(
      ["chat"],
    );
  });

  it("renames, reorders and deletes a model", async () => {
    const settings = service();

    await settings.addPersonalModel("openai", "second", {});
    await settings.renamePersonalModel("openai", "second", "second-renamed");
    expect(readModels().map((model) => model.name)).toEqual([
      "local",
      "sonnet",
      "second-renamed",
    ]);

    await settings.reorderPersonalModels("openai", ["second-renamed", "local"]);
    // Reordering one family keeps every other family at its absolute position.
    expect(readModels().map((model) => model.name)).toEqual([
      "second-renamed",
      "sonnet",
      "local",
    ]);

    await settings.deletePersonalModel("openai", "second-renamed");
    expect(readModels().map((model) => model.name)).toEqual([
      "sonnet",
      "local",
    ]);
  });

  it("deletes a provider with all of its models", async () => {
    const settings = service();

    await settings.deletePersonalProvider("anthropic");

    expect(readModels().map((model) => model.name)).toEqual(["local"]);
  });

  it("keeps a typed endpoint and key when the first model is added quickly", async () => {
    writeConfig([]);
    const settings = service();

    await settings.savePersonalProviderOverlay("openai", {
      api: {
        type: "openai-chat-completions",
        baseUrl: "http://127.0.0.1:3425/v1",
      },
      access: { type: "api-key", apiKey: "magpie" },
    } as never);

    // No model exists yet, but the form must still show what was typed.
    let view = await settings.getView();
    const provider = view.providers.find(
      (entry) => entry.providerId === "openai",
    );
    expect(provider?.effectiveConfig.api?.baseUrl).toBe(
      "http://127.0.0.1:3425/v1",
    );

    await settings.addPersonalModel("openai", "fast", {});
    const entry = readModels().find((model) => model.name === "fast");
    expect(entry?.apiBase).toBe("http://127.0.0.1:3425/v1");
    expect(entry?.apiKey).toBe("magpie");

    view = await settings.getView();
    expect(
      view.providers.find((item) => item.providerId === "openai")?.models,
    ).toHaveLength(1);
  });

  it("keeps the shell-side display name across service instances", async () => {
    await service().savePersonalProviderOverlay(
      "openai",
      { api: { type: "openai-chat-completions" }, access: { type: "api-key" } },
      { providerName: "Local Gateway" },
    );

    const view = await service().getView();
    expect(
      view.providers.find((provider) => provider.providerId === "openai")
        ?.providerName,
    ).toBe("Local Gateway");
  });
});
