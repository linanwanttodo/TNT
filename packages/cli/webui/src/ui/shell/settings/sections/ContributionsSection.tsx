import type { PluginsResponse } from "../../../../api/client.js";
import { ContributionList } from "../shared.tsx";

type ContributionKind = "skills" | "commands" | "agents";
type PluginContribution = PluginsResponse["skills"][number];

export interface ContributionsSectionProps {
  kind: ContributionKind;
  items: PluginContribution[];
  total: number;
  onClear: () => void;
}

const EMPTY_TITLES: Record<ContributionKind, { empty: string; none: string }> =
  {
    skills: {
      empty: "No matching skills",
      none: "No skills installed",
    },
    commands: {
      empty: "No matching commands",
      none: "No plugin commands",
    },
    agents: {
      empty: "No matching agents",
      none: "No plugin agents",
    },
  };

const EMPTY_BODIES: Record<ContributionKind, string> = {
  skills:
    "Skills ship inside plugins. Install a plugin that declares skills, then refresh.",
  commands:
    "Commands ship inside plugins. Install a plugin that declares commands, then refresh.",
  agents:
    "Agents ship inside plugins. Install a plugin that declares agents, then refresh.",
};

export function ContributionsSection({
  kind,
  items,
  total,
  onClear,
}: ContributionsSectionProps) {
  const titles = EMPTY_TITLES[kind];
  return (
    <ContributionList
      items={
        kind === "commands"
          ? items.map((item) => ({ ...item, name: `/${item.name}` }))
          : items
      }
      emptyTitle={total === 0 ? titles.none : titles.empty}
      emptyBody={
        total === 0
          ? EMPTY_BODIES[kind]
          : "Try a different name or clear the search."
      }
      onClear={onClear}
    />
  );
}
