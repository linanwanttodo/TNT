import { describe, expect, it } from "vitest";

import { capHookContext, compactSkillReminder } from "./fireHook.js";

describe("the hook context budget", () => {
  it("leaves short context untouched", () => {
    const note =
      "<EXTREMELY_IMPORTANT>You have superpowers.</EXTREMELY_IMPORTANT>";
    expect(capHookContext(note)).toBe(note);
  });

  it("truncates a plugin that ships a whole manual", () => {
    const manual = "x".repeat(50_000);
    const capped = capHookContext(manual);

    expect(capped.length).toBeLessThan(manual.length);
    expect(capped).toContain("hook context truncated");
    expect(capped).toContain("Skills tool");
  });

  it("keeps the truncation point inside the budget", () => {
    const capped = capHookContext("y".repeat(10_000));
    // The budget plus the marker, with slack for the notice line.
    expect(capped.length).toBeLessThan(4_200);
  });
});

describe("compactSkillReminder", () => {
  it("replaces an inlined skill manual with a one-line pointer", () => {
    const manual = [
      "<system-reminder>",
      "**Below is the full content of your 'superpowers:using-superpowers' skill**",
      "Use when starting any conversation - establishes how to find and use skills,",
      "requiring skill invocation before ANY response including clarifying questions.",
      "If you think there is even a 1% chance a skill might apply, you ABSOLUTELY MUST invoke the skill.",
      " ".repeat(1400),
      "</system-reminder>",
    ].join("\n");
    const compact = compactSkillReminder(manual);
    expect(compact.length).toBeLessThan(300);
    expect(compact).toContain("Skills are available");
    expect(compact).toContain("Background context");
    expect(compact).not.toContain("ABSOLUTELY MUST");
  });

  it("leaves ordinary hook context alone", () => {
    const note = "Session started in /tmp with model X";
    expect(compactSkillReminder(note)).toBe(note);
  });
});

describe("per-prompt hook context budget", () => {
  it("caps a UserPromptSubmit note far below the one-shot session note", () => {
    const long = "x".repeat(5000);
    expect(capHookContext(long, 1000)).toContain(
      "truncated at 1000 characters",
    );
    expect(capHookContext(long, 1000).startsWith("x".repeat(1000))).toBe(true);
    expect(capHookContext(long)).toContain("truncated at 4000 characters");
  });
});
