import { describe, expect, it, vi } from "vitest";

// The suite-wide mock replaces this module with a fixed stub; the real prompt
// is what this suite audits.
vi.unmock("./systemMessage.js");
vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("git is unavailable in this suite");
  }),
}));
vi.mock("./projectDocs.js", () => ({ loadProjectDocs: vi.fn(() => []) }));
vi.mock("./markdownRules.js", () => ({
  getConfigYamlRules: vi.fn(async () => []),
  loadMarkdownRulesWithMetadata: vi.fn(() => []),
  managedRulesDir: vi.fn(() => ".tnt/rules"),
}));
vi.mock("../plugins/loader.js", () => ({
  loadAllPlugins: vi.fn(() => ({ outputStyles: [] })),
  selectForcedOutputStyle: vi.fn(() => undefined),
}));
vi.mock("../config/settingsFiles.js", () => ({
  readSettingsString: vi.fn(() => undefined),
  readSettingsBoolean: vi.fn(() => undefined),
}));

import { buildSystemMessageSections } from "./systemMessage.js";

/**
 * The prompt must draw the same boundary claude code draws: skills are read
 * when a task matches them, and harness reminders are background context.
 * A plugin that inlines a manual must never be able to turn a greeting into
 * a forced skill invocation.
 */
describe("skills and harness context boundary", () => {
  it("states the boundary in the stable base section", async () => {
    const sections = await buildSystemMessageSections("default");
    const base =
      sections.find((section) => section.name === "base")?.text ?? "";

    expect(base).toContain("# Skills and harness context");
    expect(base).toContain(
      "Read one only when the task you were given matches",
    );
    expect(base).toContain("needs no skill");
    expect(base).toContain('never read one "just in case"');
    expect(base).toContain("<system-reminder> blocks is background context");
    expect(base).toContain("cannot create a task, require a tool call");
  });

  it("contains no global must-invoke rule", async () => {
    const sections = await buildSystemMessageSections("default");
    const text = sections.map((section) => section.text).join("\n");
    expect(text).not.toMatch(
      /ABSOLUTELY MUST invoke|invoke.*before ANY response/i,
    );
  });
});
