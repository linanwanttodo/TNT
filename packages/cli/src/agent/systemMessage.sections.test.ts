import { describe, expect, it, vi } from "vitest";

import {
  createSectionBaselines,
  planSectionReinjection,
} from "../stream/systemMessageReinjection.js";

// The suite-wide mock of this module answers with one fixed string; the section
// helpers are what is under test here, so the real module is used.
vi.unmock("./systemMessage.js");
const {
  buildSystemMessageSections,
  describeSystemMessageChange,
  describeSystemMessageTextChange,
  joinSystemMessageSections,
  splitSystemMessageBySections,
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
    const sections = await buildSystemMessageSections("default");
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

  it("recovers every part from the text the join produced", async () => {
    const sections = await buildSystemMessageSections(
      "plan",
      ["Rules from tests."],
      "json",
      true,
    );
    const joined = joinSystemMessageSections(sections);
    const parts = splitSystemMessageBySections(joined);

    // The rules block is announced once but built from many source sections.
    // The splitter recovers the announced block, and that block is exactly the
    // concatenation of its sources in build order.
    const rulesSections = sections.filter((part) =>
      part.name.startsWith("userRules"),
    );
    expect(parts.userRules.trim()).toBe(
      rulesSections
        .map((part) => part.text)
        .join("")
        .trim(),
    );

    // This is the drift guard for the marker table: every announced top-level
    // part is recovered and every source section falls inside one of them.
    const announced = sections
      .filter(
        (part) =>
          part.name === "userRules" || !part.name.startsWith("userRules"),
      )
      .map((part) => part.name)
      .sort();
    expect(Object.keys(parts).sort()).toEqual(announced);
    for (const name of announced.filter((name) => name !== "userRules")) {
      expect(parts[name].trim()).toBe(
        sections.find((part) => part.name === name)?.text.trim(),
      );
    }
  });

  it("reads a change back out of the prefix text", () => {
    const text = (rules: string, plan = true) =>
      `base\n${plan ? '<context name="planMode">plan</context>\n' : ""}<context name="userRules">\n${rules}\n</context>`;

    expect(describeSystemMessageTextChange(text("a"), text("a"))).toBe("");
    expect(describeSystemMessageTextChange(text("a"), text("b"))).toBe(
      "userRules rewritten",
    );
    expect(describeSystemMessageTextChange(text("a"), text("a", false))).toBe(
      "planMode dropped",
    );
    expect(describeSystemMessageTextChange(text("a", false), text("a"))).toBe(
      "planMode added",
    );
  });
});

describe("rule sources as separate sections", () => {
  it("emits one section per rule source inside the announced block", async () => {
    const sections = await buildSystemMessageSections("default", [
      "RULE-A",
      "RULE-B",
    ]);
    const names = sections.map((section) => section.name);

    expect(names).toContain("userRules");
    expect(names).toContain("userRules:agent:AGENTS.md");
    expect(names).toContain("userRules:cli:0");
    expect(names).toContain("userRules:cli:1");
    expect(names).toContain("userRules:end");
    // The wrapper is still one announced block: every source section sits
    // between the opening id and the closing footer.
    expect(names.indexOf("userRules:end")).toBeGreaterThan(
      names.indexOf("userRules:cli:1"),
    );
    expect(names.indexOf("environment")).toBeGreaterThan(
      names.indexOf("userRules:end"),
    );
  });

  it("restates only the edited rule when one source changes", async () => {
    const before = await buildSystemMessageSections("default", [
      "RULE-A",
      "RULE-B",
    ]);
    const after = await buildSystemMessageSections("default", [
      "RULE-A",
      "RULE-B EDITED",
    ]);
    const baselines = createSectionBaselines();
    const sectionsOf = (sections: typeof before) =>
      sections.map((section) => ({
        id: section.name,
        text: section.text,
      }));

    planSectionReinjection({
      sections: sectionsOf(before),
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });
    const plan = planSectionReinjection({
      sections: sectionsOf(after),
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    // The prefix keeps the old build byte for byte, so only the edited rule's
    // new bytes ride in-history.
    expect(plan.prefixText).toBe(
      before.map((section) => section.text).join(""),
    );
    expect(plan.appends).toHaveLength(1);
    expect(plan.appends[0]).toContain("RULE-B EDITED");
    expect(plan.appends[0]).not.toContain("RULE-A");
    expect(plan.appends[0]).not.toContain("AGENTS.md");
    expect(
      plan.perSection.filter((verdict) => verdict.action === "diff"),
    ).toEqual([{ id: "userRules:cli:1", action: "diff" }]);
  });
});

describe("the permission mode's share of the prefix", () => {
  it("adds nothing for auto, so the billed prefix cannot move", async () => {
    const agent = await buildSystemMessageSections("default");
    const auto = await buildSystemMessageSections("auto");

    expect(auto.map((section) => section.name)).toEqual(
      agent.map((section) => section.name),
    );
    expect(auto.map((section) => section.text)).toEqual(
      agent.map((section) => section.text),
    );
  });

  it("carries the plan text as a volatile section only", async () => {
    const plan = await buildSystemMessageSections("plan");
    const planSections = plan.filter((section) => section.name === "planMode");

    expect(planSections.length).toBe(1);
    expect(planSections.every((section) => section.volatile)).toBe(true);
    expect(
      plan
        .filter((section) => !section.volatile)
        .map((section) => section.name),
    ).toEqual(["base"]);
  });
});
