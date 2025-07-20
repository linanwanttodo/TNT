import { MessageModes } from "core";

/**
 * Which tools a mode may use. `agent` and `multitask` run the full enabled
 * set; `plan`, `debug` and `chat` keep the read-only tools so the model can
 * still look things up without changing files.
 */
export type ModeToolAccess = "all" | "readonly" | "none";

export interface ModeDefinition {
  id: MessageModes;
  labelKey: string;
  descriptionKey: string;
  placeholderKey: string;
  toolAccess: ModeToolAccess;
}

/**
 * The modes the composer offers, in display order. These are fixed: the agent
 * loop, the system prompt, and the tool policy all key off the mode id, so a
 * user-defined mode would have no defined behavior behind it. Everything that
 * needs the list (the composer menu, the placeholder) reads from here.
 */
export const MODE_DEFINITIONS: ModeDefinition[] = [
  {
    id: "plan",
    labelKey: "composer.addMenu.mode.plan.label",
    descriptionKey: "composer.addMenu.mode.plan.desc",
    placeholderKey: "composer.placeholder.plan",
    toolAccess: "readonly",
  },
  {
    id: "debug",
    labelKey: "composer.addMenu.mode.debug.label",
    descriptionKey: "composer.addMenu.mode.debug.desc",
    placeholderKey: "composer.placeholder.debug",
    toolAccess: "readonly",
  },
  {
    id: "multitask",
    labelKey: "composer.addMenu.mode.multitask.label",
    descriptionKey: "composer.addMenu.mode.multitask.desc",
    placeholderKey: "composer.placeholder.multitask",
    toolAccess: "all",
  },
  {
    id: "chat",
    labelKey: "composer.addMenu.mode.chat.label",
    descriptionKey: "composer.addMenu.mode.chat.desc",
    placeholderKey: "composer.placeholder.chat",
    toolAccess: "readonly",
  },
  {
    id: "agent",
    labelKey: "composer.addMenu.mode.agent.label",
    descriptionKey: "composer.addMenu.mode.agent.desc",
    placeholderKey: "composer.placeholder.agent",
    toolAccess: "all",
  },
];

export const DEFAULT_MODE: MessageModes = "agent";

export function getModeToolAccess(mode: MessageModes): ModeToolAccess {
  return (
    MODE_DEFINITIONS.find((definition) => definition.id === mode)?.toolAccess ??
    "all"
  );
}

export interface ResolvedMode {
  id: MessageModes;
  label: string;
  description: string;
  placeholder: string;
  toolAccess: ModeToolAccess;
}

export function resolveModes(
  translate: (key: string) => string,
): ResolvedMode[] {
  return MODE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: translate(definition.labelKey),
    description: translate(definition.descriptionKey),
    placeholder: translate(definition.placeholderKey),
    toolAccess: definition.toolAccess,
  }));
}
