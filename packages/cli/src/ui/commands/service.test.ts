import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/loadMarkdownSkills.js", () => ({
  getSkillSlashCommandName: vi.fn((skill: { name: string }) => skill.name),
  loadMarkdownSkills: vi.fn(async () => ({ skills: [] })),
}));

import { setLocale, t } from "../../i18n/index.js";
import { loadMarkdownSkills } from "../../utils/loadMarkdownSkills.js";
import { CommandService, getAllSlashCommands } from "./service.js";

describe("localized system commands", () => {
  beforeEach(() => setLocale("en"));

  it("includes a language command whose description follows the locale", async () => {
    const assistant = { name: "test" } as any;
    const englishCommands = await getAllSlashCommands(assistant);
    const englishLanguageCommand = englishCommands.find(
      (command) => command.name === "language",
    );

    expect(englishLanguageCommand?.description).toBe(t("language.title"));

    setLocale("zh-CN");
    const localizedCommands = await getAllSlashCommands(assistant);
    const localizedLanguageCommand = localizedCommands.find(
      (command) => command.name === "language",
    );

    expect(localizedLanguageCommand?.description).toBe(t("language.title"));
    expect(localizedLanguageCommand?.description).not.toBe(
      englishLanguageCommand?.description,
    );
  });

  it("translates built-in command descriptions with the locale", async () => {
    const assistant = { name: "test" } as any;
    const englishCommands = await getAllSlashCommands(assistant);
    const englishHelp = englishCommands.find(
      (command) => command.name === "help",
    );

    expect(englishHelp?.description).toBe(t("cmd.help"));

    setLocale("zh-CN");
    const localizedCommands = await getAllSlashCommands(assistant);
    const localizedHelp = localizedCommands.find(
      (command) => command.name === "help",
    );

    expect(localizedHelp?.description).toBe(t("cmd.help"));
    expect(localizedHelp?.description).not.toBe(englishHelp?.description);
    expect(localizedHelp?.name).toBe("help");
  });

  it("keeps descriptions supplied by plugins and prompts untouched", async () => {
    const assistant = {
      name: "test",
      prompts: [
        {
          name: "test-prompt",
          prompt: "Test prompt",
          description: "Test prompt description",
        },
      ],
    } as any;

    setLocale("zh-CN");
    const commands = await getAllSlashCommands(assistant);
    const promptCommand = commands.find(
      (command) => command.name === "test-prompt",
    );

    expect(promptCommand?.description).toBe("Test prompt description");
  });

  it("keeps the built-in command when a skill claims the same name", async () => {
    vi.mocked(loadMarkdownSkills).mockResolvedValueOnce({
      skills: [{ name: "help", description: "Skill help", path: "/tmp/help" }],
    } as any);

    const service = await CommandService.create({ name: "test" } as any);
    const helpCommands = service
      .getCommands()
      .filter((command) => command.name === "help");

    expect(helpCommands).toHaveLength(1);
    expect(helpCommands[0].category).toBe("system");
    expect(service.getConflicts()).toEqual([
      expect.objectContaining({ name: "help", winner: "builtin" }),
    ]);
  });

  it("exposes only remote commands in remote mode", async () => {
    const service = await CommandService.create({ name: "test" } as any, {
      isRemoteMode: true,
    });

    expect(service.getCommands().map((command) => command.name)).toEqual([
      "exit",
      "diff",
      "apply",
    ]);
    expect(service.getConflicts()).toEqual([]);
  });

  it("answers lookups regardless of case", async () => {
    const service = await CommandService.create({ name: "test" } as any);

    expect(service.find("HELP")?.name).toBe("help");
    expect(service.matches("lang").map((command) => command.name)).toContain(
      "language",
    );
  });
});
