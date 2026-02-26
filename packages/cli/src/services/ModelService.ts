import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";

import { createLlmApi, getLlmApi } from "../config/index.js";
import { t } from "../i18n/index.js";
import { BUILT_IN_AGENTS } from "../subagent/builtInAgents.js";
import { logger } from "../utils/logger.js";
import { getPersistedModelName } from "../utils/modelPersistence.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import { AgentFileServiceState, ModelServiceState } from "./types.js";

/**
 * Service for managing LLM and model state
 */
export class ModelService
  extends BaseService<ModelServiceState>
  implements ServiceWithDependencies
{
  private availableModels: ModelConfig[] = [];
  private assistant: AssistantUnrolled | null = null;

  constructor() {
    super("ModelService", {
      llmApi: null,
      model: null,
      assistant: null,
    });
  }

  /**
   * Declare dependencies on other services
   */
  getDependencies(): string[] {
    return ["config", "agentFile"];
  }

  /**
   * Initialize the model service
   */
  async doInitialize(
    assistant: AssistantUnrolled,
    agentFileServiceState: AgentFileServiceState | undefined,
    selectedModelName: string | null = null,
  ): Promise<ModelServiceState> {
    logger.debug("ModelService.doInitialize called", {
      hasAssistant: !!assistant,
      assistantModelsCount: assistant?.models?.length || 0,
    });

    this.assistant = assistant;
    this.availableModels = (assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    let preferredModelName: string | null | undefined = null;
    let modelSource = "default";

    // Priority = agentFile -> config.yaml's `model:` -> legacy persisted key
    if (agentFileServiceState?.agentFileModel?.name) {
      preferredModelName = agentFileServiceState.agentFileModel?.name;
      modelSource = "agentFile";
    } else if (selectedModelName) {
      preferredModelName = selectedModelName;
      modelSource = "config";
    } else {
      const persistedName = getPersistedModelName();
      if (persistedName) {
        preferredModelName = persistedName;
        modelSource = "persisted";
      }
    }

    // Try to use the preferred model (agent file or persisted)
    if (preferredModelName) {
      // During initialization, we need to check against availableModels directly
      const modelIndex = this.availableModels.findIndex((model) => {
        const name = (model as any).name || (model as any).model;
        return name === preferredModelName;
      });
      if (modelIndex === -1) {
        logger.warn("Preferred model is not defined in the loaded config", {
          preferredModelName,
          modelSource,
        });
        // Preferred model not found, use default model selection
        const [llmApi, model] = getLlmApi(assistant);
        return {
          llmApi,
          model,
          assistant,
        };
      } else {
        // Use the preferred model - but we need to handle initialization specially
        // During init, currentState isn't set yet, so switchModel would fail
        // Instead, we'll manually switch here
        const selectedModel = this.availableModels[modelIndex];
        logger.debug(`Using ${modelSource} model during initialization`, {
          modelIndex,
          provider: selectedModel.provider,
          name: (selectedModel as any).name || "unnamed",
          modelSource,
        });

        const llmApi = createLlmApi(selectedModel);
        if (!llmApi) {
          throw new Error(
            t("services.llmInitWithSource", { source: modelSource }),
          );
        }

        return {
          llmApi,
          model: selectedModel,
          assistant,
        };
      }
    } else {
      // Use default model selection
      const [llmApi, model] = getLlmApi(assistant);
      return {
        llmApi,
        model,
        assistant,
      };
    }
  }

  /**
   * Override isReady to check for required state
   */
  override isReady(): boolean {
    return (
      super.isReady() &&
      this.currentState.llmApi !== null &&
      this.currentState.model !== null
    );
  }

  /**
   * Get model information for display
   */
  getModelInfo(): { provider: string; name: string } | null {
    if (!this.currentState.model) {
      return null;
    }

    return {
      provider: this.currentState.model.provider,
      name: (this.currentState.model as any).name || "unnamed",
    };
  }

  /**
   * Get list of available chat models
   */
  getAvailableChatModels(): Array<{
    provider: string;
    name: string;
    index: number;
  }> {
    // Get assistant from state to ensure we have the latest data
    const { assistant } = this.getState();
    if (!assistant || !assistant.models) {
      return [];
    }

    // Filter for chat models
    const chatModels = (assistant.models.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    return chatModels.map((model, index) => ({
      provider: model.provider,
      name: (model as any).name || (model as any).model || "unnamed",
      index,
    }));
  }

  /**
   * Switch to a different chat model by index
   */
  async switchModel(modelIndex: number): Promise<ModelServiceState> {
    // Fall back to the instance property: state is not set yet during initialization
    const stateValues = this.getState();
    const assistant = stateValues.assistant || this.assistant;

    logger.debug("switchModel: Checking state", {
      hasStateAssistant: !!stateValues.assistant,
      hasInstanceAssistant: !!this.assistant,
      isInitialized: this.isReady(),
      isReady: this.isReady(),
      modelIndex,
    });

    if (!assistant) {
      logger.error("switchModel: Missing assistant data", {
        assistant: !!assistant,
        stateKeys: Object.keys(stateValues),
        currentState: {
          hasLlmApi: !!stateValues.llmApi,
          hasModel: !!stateValues.model,
          hasAssistant: !!stateValues.assistant,
        },
      });
      throw new Error(t("services.modelServiceNotInitialized"));
    }

    // Get available models from assistant in state
    const availableModels = (assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    if (modelIndex < 0 || modelIndex >= availableModels.length) {
      throw new Error(
        t("services.invalidModelIndex", {
          index: modelIndex,
          max: availableModels.length - 1,
        }),
      );
    }

    const selectedModel = availableModels[modelIndex];
    logger.debug("Switching to model", {
      modelIndex,
      provider: selectedModel.provider,
      name: (selectedModel as any).name || "unnamed",
    });

    try {
      const llmApi = createLlmApi(selectedModel);

      if (!llmApi) {
        throw new Error(t("services.llmInitSelected"));
      }

      this.setState({
        llmApi,
        model: selectedModel,
        assistant,
      });

      logger.debug("Model switched successfully", {
        modelProvider: selectedModel.provider,
        modelName: (selectedModel as any).name || "unnamed",
      });

      return this.getState();
    } catch (error: any) {
      logger.error("Failed to switch model:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Get current model index
   */
  getCurrentModelIndex(): number {
    const state = this.getState();
    if (!state.model || !state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels = (state.assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    return availableModels.findIndex(
      (model) =>
        model.provider === state.model?.provider &&
        (model as any).name === (state.model as any).name,
    );
  }

  /**
   * Get model index by name and provider
   */
  getModelIndexByName(modelName: string, provider?: string): number {
    const state = this.getState();
    if (!state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels = (state.assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    return availableModels.findIndex((model) => {
      const name = (model as any).name || (model as any).model;
      const nameMatches = name === modelName;

      if (provider) {
        return nameMatches && model.provider === provider;
      }

      return nameMatches;
    });
  }

  /**
   * A configured model by name, as a caller that has only a state object can
   * ask for one. Matches either the entry's name or its model id, because hook
   * and plugin authors write both.
   */
  static findModelByName(
    modelState: ModelServiceState,
    name: string,
  ): ModelServiceState | null {
    const match = (modelState.assistant?.models ?? []).find(
      (model) => !!model && (model.name === name || model.model === name),
    );
    if (!match) {
      return null;
    }
    return {
      llmApi: createLlmApi(match),
      model: match,
      assistant: modelState.assistant,
    };
  }

  static getSubagentModels(modelState: ModelServiceState) {
    const configuredModels = (modelState.assistant?.models ?? [])
      .filter((model) => !!model)
      .filter((model) => !!model.name) // filter out models without a name
      .filter((model) => model.roles?.includes("subagent")) // filter with role subagent
      .filter((model) => !!model.chatOptions?.baseSystemMessage); // filter those with a system message

    const entries = configuredModels.map((model) => ({
      llmApi: createLlmApi(model),
      model,
      assistant: modelState.assistant,
    }));

    // Built-in roles are defined by what they do, not by a model someone has to
    // configure, so they run on the session's own model. A configured agent that
    // takes the same name wins, because that is the user overriding a default.
    const inheritFrom = modelState.model ?? configuredModels[0];
    if (inheritFrom) {
      const declared = new Set(entries.map((entry) => entry.model.name));
      for (const agent of BUILT_IN_AGENTS) {
        if (declared.has(agent.name)) {
          continue;
        }
        const model: ModelConfig = {
          ...inheritFrom,
          name: agent.name,
          roles: ["subagent"],
          chatOptions: {
            ...inheritFrom.chatOptions,
            baseSystemMessage: agent.systemMessage,
          },
        };
        entries.push({
          llmApi: createLlmApi(model),
          model,
          assistant: modelState.assistant,
        });
      }
    }

    return entries;
  }
}
