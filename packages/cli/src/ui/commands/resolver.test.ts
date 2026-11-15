import { describe, expect, it } from "vitest";

import { resolveCommands } from "./resolver.js";
import type { LoadedCommandSet, SlashCommand } from "./types.js";

function command(
  name: string,
  category: SlashCommand["category"] = "assistant",
): SlashCommand {
  return { name, description: `${name} from ${category}`, category };
}

describe("resolveCommands", () => {
  it("keeps the first source that claims a name and reports the rest", () => {
    const sets: LoadedCommandSet[] = [
      { source: "builtin", commands: [command("help", "system")] },
      {
        source: "plugin",
        commands: [command("help"), command("sample:review")],
      },
    ];

    const { commands, conflicts } = resolveCommands(sets);

    expect(commands.map((entry) => entry.name)).toEqual([
      "help",
      "sample:review",
    ]);
    expect(commands[0].category).toBe("system");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].name).toBe("help");
    expect(conflicts[0].winner).toBe("builtin");
    expect(conflicts[0].losers.map((loser) => loser.source)).toEqual([
      "plugin",
    ]);
  });

  it("compares names case-insensitively and keeps the first spelling", () => {
    const sets: LoadedCommandSet[] = [
      { source: "builtin", commands: [command("Review", "system")] },
      { source: "skill", commands: [command("review")] },
    ];

    const { commands, conflicts } = resolveCommands(sets);

    expect(commands.map((entry) => entry.name)).toEqual(["Review"]);
    expect(conflicts).toHaveLength(1);
  });

  it("reports every loser when several sources claim one name", () => {
    const sets: LoadedCommandSet[] = [
      { source: "prompt", commands: [command("shared")] },
      { source: "skill", commands: [command("shared")] },
      { source: "plugin", commands: [command("shared")] },
    ];

    const { commands, conflicts } = resolveCommands(sets);

    expect(commands).toHaveLength(1);
    expect(conflicts[0].winner).toBe("prompt");
    expect(conflicts[0].losers.map((loser) => loser.source)).toEqual([
      "skill",
      "plugin",
    ]);
  });

  it("preserves loader order for names that do not collide", () => {
    const sets: LoadedCommandSet[] = [
      {
        source: "builtin",
        commands: [command("a", "system"), command("b", "system")],
      },
      { source: "skill", commands: [command("c")] },
    ];

    const { commands, conflicts } = resolveCommands(sets);

    expect(commands.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(conflicts).toEqual([]);
  });
});
