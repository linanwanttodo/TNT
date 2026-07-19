import { describe, expect, it } from "vitest";

import type { SlashCommand } from "./commands/types.js";
import { parseSlashInput } from "./slashCommandParser.js";

const commands: SlashCommand[] = [
  { name: "help", description: "Show help", category: "system" },
  { name: "model", description: "Pick a model", category: "system" },
  {
    name: "language",
    description: "Set language",
    category: "system",
    subcommands: [
      { name: "en", description: "English" },
      { name: "zh-CN", description: "简体中文" },
    ],
  },
  {
    name: "config",
    description: "Configuration",
    category: "system",
    subcommands: [
      { name: "theme", description: "Theme" },
      { name: "keybindings", description: "Keys" },
    ],
  },
];

describe("parseSlashInput", () => {
  it("offers the root level for a bare slash and a partial", () => {
    const bare = parseSlashInput("/", 1, commands);
    expect(bare.active).toBe(true);
    expect(bare.filter).toBe("");
    expect(bare.level).toHaveLength(commands.length);

    const partial = parseSlashInput("/he", 3, commands);
    expect(partial.filter).toBe("he");
    expect(partial.level).toHaveLength(commands.length);
  });

  it("descends into a parent's children after the separating space", () => {
    const parsed = parseSlashInput("/language ", 10, commands);
    expect(parsed.active).toBe(true);
    expect(parsed.path).toEqual(["language"]);
    expect(parsed.filter).toBe("");
    expect(parsed.level.map((command) => command.name)).toEqual([
      "en",
      "zh-CN",
    ]);
  });

  it("filters children by the partial token", () => {
    const parsed = parseSlashInput("/language z", 11, commands);
    expect(parsed.path).toEqual(["language"]);
    expect(parsed.filter).toBe("z");
    expect(parsed.level.map((command) => command.name)).toContain("zh-CN");
  });

  it("closes the palette inside a leaf's free-form arguments", () => {
    expect(parseSlashInput("/model gpt-4", 12, commands).active).toBe(false);
    expect(parseSlashInput("/model ", 7, commands).active).toBe(false);
  });

  it("closes the palette after a completed child takes its arguments", () => {
    // TNT's command tree is two levels deep; anything past a completed
    // child is that command's argument, not another palette level.
    expect(parseSlashInput("/language zh-CN extra", 21, commands).active).toBe(
      false,
    );
  });

  it("stays inactive for ordinary text and for the caret left of the slash", () => {
    expect(parseSlashInput("hello", 5, commands).active).toBe(false);
    expect(parseSlashInput(" /help", 0, commands).active).toBe(false);
  });
});
