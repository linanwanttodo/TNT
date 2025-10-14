import { describe, expect, it, vi } from "vitest";

// The suite-wide mock of this module answers with one fixed string; the section
// helpers are what is under test here, so the real module is used.
vi.unmock("./systemMessage.js");
const {
  buildSystemMessageSections,
  describeSystemMessageChange,
  joinSystemMessageSections,
} = await import("./systemMessage.js");
type SystemMessageSection = import("./systemMessage.js").SystemMessageSection;

vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn().mockResolvedValue({ config: { rules: [] } }),
    set: vi.fn(),
  },
}));
vi.mock("../config/hubLoader.js", () => ({
  processRule: vi
    .fn()
    .mockImplementation((spec: string) => Promise.resolve(spec)),
}));

const section = (
  name: string,
  text: string,
  volatile = true,
): SystemMessageSection => ({ name, text, volatile });

describe("system message sections", () => {
  it("builds the prefix as parts that survive the join untouched", async () => {
    const sections = await buildSystemMessageSections("agent");
    const joined = joinSystemMessageSections(sections);

    // The prefix is exactly its parts, with no separator invented by the join:
    // each part carries its own blank lines. A join that adds anything changes the
    // billed bytes while reporting no change at all.
    expect(sections.length).toBeGreaterThan(0);
    expect(joined).toBe(sections.map((part) => part.text).join(""));
    for (const part of sections) {
      expect(joined).toContain(part.text);
    }
    expect(sections[0].name).toBe("base");
  });

  it("keeps the parts a session changes marked as volatile", async () => {
    const byName = new Map(
      (
        await buildSystemMessageSections("plan", undefined, undefined, true)
      ).map((part) => [part.name, part]),
    );

    // The base text is the CLI's own and only changes with a release; the mode
    // text is what a plan-to-agent switch moves. Saying which is which turns a
    // cache miss into an actionable note.
    expect(byName.get("base")?.volatile).toBe(false);
    expect(byName.get("planMode")?.volatile).toBe(true);
    expect(byName.get("headless")?.volatile).toBe(false);
    expect(byName.get("userRules")?.volatile).toBe(true);
  });

  it("names the part that moved, and says nothing when none did", () => {
    const previous = [section("base", "A"), section("planMode", "P")];
    const identical = [section("base", "A"), section("planMode", "P")];
    expect(describeSystemMessageChange(previous, identical)).toBe("");

    expect(
      describeSystemMessageChange(previous, [
        section("base", "A2"),
        section("planMode", "P"),
      ]),
    ).toBe("base rewritten");

    expect(describeSystemMessageChange(previous, [section("base", "A")])).toBe(
      "planMode dropped",
    );

    expect(
      describeSystemMessageChange(
        [section("base", "A")],
        [section("base", "A"), section("outputStyle", "S")],
      ),
    ).toBe("outputStyle added");
  });

  it("reports the parts in the order the new build has them", () => {
    const change = describeSystemMessageChange(
      [section("userRules", "R"), section("base", "A")],
      [
        section("userRules", "R2"),
        section("outputStyle", "S"),
        section("base", "A"),
      ],
    );

    // The report follows the build order, which is the order the prefix is
    // billed in. The fixture is deliberately one where build order and
    // alphabetical order differ, so a sorted list cannot pass for the right
    // reason.
    expect(change).toBe("userRules rewritten; outputStyle added");
  });
});
