/**
 * The chat models a surface can offer, and the switch between them.
 *
 * The TUI reaches these through a React hook and a full-screen picker; the web
 * UI and any other headless surface needs the same two operations without the
 * terminal's navigation, so the recipe lives here once: the model list, and a
 * switch that leaves the service container and the saved selection in the state
 * the next turn reads.
 */
import {
  defaultConfigPath,
  writeSelectedModelName,
} from "../config/modelSelection.js";
import { t } from "../i18n/index.js";

import type { ConfigServiceState, ModelServiceState } from "./types.js";

import { SERVICE_NAMES, serviceContainer } from "./index.js";
import { services } from "./index.js";

/** One choice in the list, with the flag that says which one is in use. */
export interface ChatModelOption {
  index: number;
  name: string;
  provider: string;
  current: boolean;
}

/**
 * The chat models the current assistant offers, in the order `switchChatModel`
 * takes an index from.
 * @returns the list, empty when no assistant is loaded.
 */
export function listChatModels(): ChatModelOption[] {
  const current = services.model.getCurrentModelIndex();
  return services.model.getAvailableChatModels().map((model) => ({
    index: model.index,
    name: model.name,
    provider: model.provider,
    current: model.index === current,
  }));
}

/**
 * Move the process to another chat model, the way the /model screen does.
 * @param index - a position in `listChatModels`.
 * @returns the model now in use.
 * @throws when the index is not in the list, or the model service cannot switch.
 */
export async function switchChatModel(index: number): Promise<ChatModelOption> {
  const options = listChatModels();
  const target = options.find((option) => option.index === index);
  if (!target) {
    throw new Error(
      t("services.noChatModelAtIndex", {
        index,
        count: options.length,
      }),
    );
  }

  const state = await services.model.switchModel(index);
  serviceContainer.set<ModelServiceState>(SERVICE_NAMES.MODEL, state);

  const info = services.model.getModelInfo();
  if (info?.name) {
    // A selection that cannot be written down is still the model this process
    // now runs: the terminal's saved choice simply stays as it was.
    try {
      const configState = services.config.getState();
      writeSelectedModelName(
        info.name,
        configState.configPath ?? defaultConfigPath(),
      );
      serviceContainer.set<ConfigServiceState>(SERVICE_NAMES.CONFIG, {
        ...configState,
        selectedModel: info.name,
      });
    } catch (error) {
      const { logger } = await import("../utils/logger.js");
      logger.debug("Failed to save the selected model:", error as Error);
    }
  }

  return { ...target, current: true };
}
