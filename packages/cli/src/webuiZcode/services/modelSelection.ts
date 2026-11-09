import { Emitter } from "@zcode/rpc";
import {
  IModelSelectionService,
  type ModelSelectionView,
  type ModelSelectionViewInput,
} from "@zcode/services";

import { REASONING_DEPTH_VALUES } from "../../session/reasoningOverride.js";

/** The part of a TNT model entry the picker needs. */
export interface TntModelEntry {
  name: string;
  provider: string;
  model: string;
  apiBase?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  useResponsesApi?: boolean;
  roles?: string[];
}

export interface TntModelSource {
  models: readonly TntModelEntry[];
  /** The session's selected model name, when the config names one. */
  selected?: string | null;
}

/** TNT assumes this window when a model entry does not state one. */
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

function apiTypeFor(
  model: TntModelEntry,
):
  | "anthropic-messages"
  | "openai-chat-completions"
  | "openai-responses"
  | undefined {
  if (model.provider === "anthropic") {
    return "anthropic-messages";
  }
  if (model.provider === "openai" || model.provider === "openai-compatible") {
    return model.useResponsesApi
      ? "openai-responses"
      : "openai-chat-completions";
  }
  // Providers TNT speaks through its own adapters (gemini, ollama, bedrock,
  // ...) have no ZCode protocol name; an empty api block is better than a
  // protocol claim the shell would show and TNT would not use.
  return undefined;
}

function contextWindow(model: TntModelEntry): number {
  return typeof model.contextLength === "number" && model.contextLength > 0
    ? model.contextLength
    : DEFAULT_CONTEXT_WINDOW;
}

function maxOutputTokens(model: TntModelEntry): number {
  const window = contextWindow(model);
  const declared =
    typeof model.maxOutputTokens === "number" && model.maxOutputTokens > 0
      ? model.maxOutputTokens
      : Math.min(DEFAULT_MAX_OUTPUT_TOKENS, Math.floor(window / 2));
  return Math.max(1, Math.min(declared, window));
}

/**
 * A complete ZCode model config from a TNT entry. The fields TNT does not
 * model per entry (image/audio input, JSON-schema output, native web search)
 * stay false: TNT never sends those request shapes, so the picker must not
 * advertise them.
 */
function registryModelConfig(model: TntModelEntry) {
  return {
    enabled: true,
    properties: {
      requiresMfjsToolSchema: false,
      contextWindow: contextWindow(model),
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: false,
    },
    optionSpecs: {
      // TNT carries reasoning as a process-wide override, not as a per-model
      // request option, so the value maps to no request field.
      reasoningLevel: {
        values: [...REASONING_DEPTH_VALUES],
        map: "{}",
      },
      maxOutputTokens: {
        max: maxOutputTokens(model),
        map: "{'max_tokens': maxOutputTokens}",
      },
    },
  };
}

function providerConfig(model: TntModelEntry) {
  const type = apiTypeFor(model);
  return type === undefined
    ? { visibility: "visible" as const }
    : {
        visibility: "visible" as const,
        api: {
          type,
          ...(model.apiBase ? { baseUrl: model.apiBase } : {}),
        },
      };
}

export function buildModelSelectionView(
  source: TntModelSource,
  revision: number,
  input?: ModelSelectionViewInput,
): ModelSelectionView {
  const groups = new Map<string, TntModelEntry[]>();
  for (const model of source.models) {
    const provider = model.provider || "tnt";
    const list = groups.get(provider);
    if (list) {
      list.push(model);
    } else {
      groups.set(provider, [model]);
    }
  }

  const providers = [...groups.entries()].map(([provider, models]) => ({
    providerId: provider,
    providerName: provider,
    templateId: provider,
    config: providerConfig(models[0]),
    models: models.map((model) => ({
      modelId: model.name,
      config: registryModelConfig(model),
    })),
  }));

  const preferredName =
    source.selected ??
    [...source.models].find((model) => model.roles?.includes("chat"))?.name ??
    source.models[0]?.name;
  const preferredModel = source.models.find(
    (model) => model.name === preferredName,
  );
  // The shell's draft initialization only accepts a preferredSelection whose
  // options.reasoningLevel is one of the model's offered values; a bare
  // identity is rejected and the composer stays empty. Complete it with the
  // highest offered level, the reference host's own fresh-draft rule.
  const preferredSelection = preferredModel
    ? {
        providerId: preferredModel.provider || "tnt",
        modelId: preferredModel.name,
        options: {
          reasoningLevel:
            registryModelConfig(
              preferredModel,
            ).optionSpecs.reasoningLevel.values.at(-1)!,
        },
      }
    : undefined;
  const available = new Set(
    providers.flatMap((provider) =>
      provider.models.map((model) => `${provider.providerId}/${model.modelId}`),
    ),
  );
  const requested = input?.selection;
  if (!requested) {
    return {
      revision,
      providers,
      ...(preferredSelection ? { preferredSelection } : {}),
    };
  }
  const found = available.has(`${requested.providerId}/${requested.modelId}`);
  return {
    revision,
    providers,
    ...(preferredSelection ? { preferredSelection } : {}),
    ...(found
      ? { effectiveSelection: requested }
      : {
          effectiveSelection: null,
          selectionIssue: "model-not-found" as const,
        }),
  };
}

/**
 * The web shell's model picker backed by TNT's own `models:` list. A selection
 * carries TNT's configured model name; TNT still resolves the provider, key and
 * endpoint from its config, as it does for the TUI picker.
 */
export function createTntModelSelectionService(
  read: () => Promise<TntModelSource>,
): IModelSelectionService {
  const changed = new Emitter<ModelSelectionView>();
  let revision = 0;
  return {
    onDidChange: changed.event,
    async getView(input) {
      const view = buildModelSelectionView(await read(), revision, input);
      revision = Math.max(revision, view.revision) + 1;
      return view;
    },
  };
}
