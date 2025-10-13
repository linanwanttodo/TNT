import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Skill } from "../utils/loadMarkdownSkills.js";

import { SKILLS_INTRO, SKILLS_TOOL_META, skillsTool } from "./skills.js";

vi.mock("../utils/loadMarkdownSkills.js");
vi.mock("../utils/logger.js");

const mockSkills: Skill[] = [
  {
    name: "test-skill",
    description: "A test skill",
    path: "/path/to/skill",
    content: "Skill content here",
    files: [],
  },
  {
    name: "skill-with-files",
    description: "Skill with extra files",
    path: "/path/to/skill2",
    content: "Another skill",
    files: ["/path/to/file1.ts", "/path/to/file2.ts"],
  },
];

describe("skillsTool", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { loadMarkdownSkills } = await import(
      "../utils/loadMarkdownSkills.js"
    );
    vi.mocked(loadMarkdownSkills).mockResolvedValue({
      skills: mockSkills,
      errors: [],
    });
  });

  it("should include skill names in description", async () => {
    const tool = await skillsTool();
    expect(tool.description).toContain("test-skill");
    expect(tool.description).toContain("skill-with-files");
  });

  it("is offered as a read-only tool", async () => {
    // Reading a skill changes nothing in the project, and the metadata is what
    // the policy coverage guard uses to insist a read-only tool stays allowed in
    // both agent and plan mode. Marking it writable loses that check.
    expect(SKILLS_TOOL_META.readonly).toBe(true);
    expect((await skillsTool()).readonly).toBe(true);
  });

  it("hands the same rules to the offered tool", async () => {
    // One source for the copy: the metadata and the dynamic tool must not drift
    // into two descriptions of the same call.
    const tool = await skillsTool();
    expect(tool.description.startsWith(SKILLS_INTRO)).toBe(true);
    expect(tool.description).toContain("name: test-skill");
  });

  it("says so when the workspace has no skills", async () => {
    const { loadMarkdownSkills } = await import(
      "../utils/loadMarkdownSkills.js"
    );
    vi.mocked(loadMarkdownSkills).mockResolvedValue({ skills: [], errors: [] });

    const tool = await skillsTool();
    expect(tool.description).toContain("No skills are installed");
  });

  describe("preprocess", () => {
    it("should return preview with skill name", async () => {
      const tool = await skillsTool();
      const result = await tool.preprocess!({ skill_name: "test-skill" });
      expect(result.preview).toEqual([
        { type: "text", content: "Reading skill: test-skill" },
      ]);
    });
  });

  describe("run", () => {
    it("should return skill content when found", async () => {
      const tool = await skillsTool();
      const result = await tool.run({ skill_name: "test-skill" });
      expect(result).toContain("<skill_name>test-skill</skill_name>");
      expect(result).toContain(
        "<skill_description>A test skill</skill_description>",
      );
      expect(result).toContain(
        "<skill_content>Skill content here</skill_content>",
      );
    });

    it("should include files when skill has files", async () => {
      const tool = await skillsTool();
      const result = await tool.run({ skill_name: "skill-with-files" });
      expect(result).toContain("<skill_files>");
      expect(result).toContain("/path/to/file1.ts");
      expect(result).toContain("<other_instructions>");
    });

    it("should throw ContinueError when skill not found", async () => {
      const tool = await skillsTool();
      const error = await tool
        .run({ skill_name: "nonexistent" })
        .catch((e) => e);
      expect(error).toBeInstanceOf(ContinueError);
      expect(error.reason).toBe(ContinueErrorReason.SkillNotFound);
      expect(error.message).toContain("nonexistent");
    });
  });
});
