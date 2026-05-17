import type { ShellGlyph } from "../icons.tsx";

export type SettingsSectionId =
  | "general"
  | "models"
  | "appearance"
  | "plugins"
  | "skills"
  | "commands"
  | "agents"
  | "mcp";

export type ListSectionId =
  "plugins" | "skills" | "commands" | "agents" | "mcp";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  glyph: ShellGlyph;
  label: string;
  description: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "general",
    glyph: "folder",
    label: "General",
    description: "Workspace, session facts and where settings live.",
  },
  {
    id: "models",
    glyph: "laptop",
    label: "Models",
    description: "The chat models this session can run on.",
  },
  {
    id: "appearance",
    glyph: "sunburst",
    label: "Appearance",
    description: "Theme and interface preferences for this browser.",
  },
  {
    id: "plugins",
    glyph: "toolbox",
    label: "Plugins",
    description:
      "Installed plugins and the contributions currently loaded from each.",
  },
  {
    id: "skills",
    glyph: "lightning",
    label: "Skills",
    description: "Skill packages the agent can load on demand.",
  },
  {
    id: "commands",
    glyph: "terminal",
    label: "Commands",
    description: "Slash commands contributed by plugins.",
  },
  {
    id: "agents",
    glyph: "robot",
    label: "Agents",
    description: "Subagent roles contributed by plugins.",
  },
  {
    id: "mcp",
    glyph: "branch",
    label: "MCP",
    description: "MCP servers configured for this process.",
  },
];

export const LIST_SECTIONS: readonly ListSectionId[] = [
  "plugins",
  "skills",
  "commands",
  "agents",
  "mcp",
];

export function isListSection(
  section: SettingsSectionId,
): section is ListSectionId {
  return (LIST_SECTIONS as readonly string[]).includes(section);
}
