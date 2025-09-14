import { describe, expect, it } from "vitest";

import { t } from "../i18n/index.js";

import {
  PLAN_MODE_TEXT,
  PROMPT_PROFILES,
  isPromptProfile,
  profileSection,
} from "./promptProfiles.js";

describe("prompt profiles", () => {
  it("adds nothing for the default profile, so a plain session is unchanged", () => {
    expect(profileSection("default")).toBe("");
  });

  it("gives plan the same text the permission mode uses", () => {
    // Two wordings of one instruction would let the agent drift between them.
    expect(profileSection("plan")).toBe(PLAN_MODE_TEXT);
    expect(profileSection("plan")).toContain("Plan Mode");
  });

  it("tells a debugging turn to find the cause first", () => {
    expect(profileSection("debug")).toContain("debugging turn");
    expect(profileSection("debug")).toContain(
      "Find the cause before proposing a fix",
    );
    expect(profileSection("debug")).toContain("reproduction command");
  });

  it("tells a review to lead with findings and where they live", () => {
    expect(profileSection("review")).toContain("Findings come first");
    expect(profileSection("review")).toContain("file and line");
    expect(profileSection("review")).toContain("If nothing is wrong");
  });

  it("recognizes exactly the profiles it offers", () => {
    for (const profile of PROMPT_PROFILES) {
      expect(isPromptProfile(profile)).toBe(true);
    }
    expect(isPromptProfile("debugging")).toBe(false);
    expect(isPromptProfile("")).toBe(false);
  });

  it("has copy for every offered profile, in every locale the keys exist for", () => {
    for (const profile of PROMPT_PROFILES) {
      const description = t(`profile.desc.${profile}` as never);
      // A missing key comes back as the key itself, which is what this catches.
      expect(description).not.toContain("profile.desc.");
      expect(description.length).toBeGreaterThan(0);
    }
  });
});
