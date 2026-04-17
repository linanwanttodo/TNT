import type { ModelConfig } from "@tnt/config-yaml";

import {
  getProjectSettingsPath,
  writeSettingsValue,
} from "../../../config/settingsFiles.js";
import { t } from "../../../i18n/index.js";
import { services } from "../../../services/index.js";
import {
  getReasoningOverride,
  parseReasoningDepth,
  setReasoningOverride,
  type ReasoningDepth,
} from "../../../session/reasoningOverride.js";
import type { SlashCommandResult } from "../types.js";

/** The status-bar label for a depth: i18n for off/default, raw otherwise. */
export function reasoningDepthLabel(depth: ReasoningDepth): string {
  if (depth === "off") return t("think.off");
  if (depth === "default") return t("think.default");
  return depth;
}

/** The depth in effect right now: the session override or the model default. */
export function effectiveReasoningDepth(model?: ModelConfig | null): string {
  const override = getReasoningOverride();
  if (override && override !== "default") {
    return reasoningDepthLabel(override);
  }
  const options = model?.defaultCompletionOptions;
  if (options?.reasoning === false) return reasoningDepthLabel("off");
  const configured = options?.reasoningEffort;
  return configured ? configured : reasoningDepthLabel("default");
}

export function handleThink(args: string[]): SlashCommandResult {
  const model = services.model?.getState()?.model as
    ModelConfig | null | undefined;

  if (args.length === 0 || args[0] === "") {
    return {
      output: t("think.current", {
        depth: effectiveReasoningDepth(model),
      }),
    };
  }

  const depth = parseReasoningDepth(args.join(" "));
  if (!depth) {
    return { output: t("think.invalid", { value: args.join(" ") }) };
  }

  setReasoningOverride(depth);
  // Persisted so the depth survives a restart; the session store only keeps the
  // live value. "default" is a real choice and is written as such.
  writeSettingsValue(getProjectSettingsPath(), "reasoningEffort", depth);

  return { output: t("think.set", { depth: reasoningDepthLabel(depth) }) };
}
