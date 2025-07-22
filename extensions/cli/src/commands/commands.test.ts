import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../util/loadMarkdownSkills.js", () => ({
  getSkillSlashCommandName: vi.fn((skill: { name: string }) => skill.name),
  loadMarkdownSkills: vi.fn(async () => ({ skills: [] })),
}));

import { getAllSlashCommands } from "./commands.js";
import { setLocale, t } from "../i18n/index.js";

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
});
