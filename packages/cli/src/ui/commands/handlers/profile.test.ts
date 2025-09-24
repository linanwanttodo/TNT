import { afterEach, describe, expect, it } from "vitest";

import {
  getSessionPromptProfile,
  setSessionPromptProfile,
} from "../../../session/index.js";

import { handleProfile } from "./profile.js";

const output = (result: ReturnType<typeof handleProfile>) =>
  String((result as { output?: string }).output ?? "");

describe("/profile", () => {
  afterEach(() => {
    setSessionPromptProfile(undefined);
  });

  it("lists what is available and what is on", () => {
    const listed = output(handleProfile([]));

    for (const name of ["default", "plan", "debug", "review"]) {
      expect(listed).toContain(name);
    }
    expect(listed).toContain("/profile");
  });

  it("sets a profile for the session, and clears it again", () => {
    expect(output(handleProfile(["debug"]))).toContain("debug");
    expect(getSessionPromptProfile()).toBe("debug");

    expect(output(handleProfile(["clear"]))).not.toContain("No mode");
    expect(getSessionPromptProfile()).toBeUndefined();
  });

  it("refuses a name it does not have, and leaves the session alone", () => {
    setSessionPromptProfile("review");

    const refused = output(handleProfile(["debugging"]));

    expect(refused).toContain("debugging");
    expect(getSessionPromptProfile()).toBe("review");
  });

  it("moves both axes for plan, because a plan that may write is not a plan", () => {
    const result = output(handleProfile(["plan"]));

    expect(getSessionPromptProfile()).toBe("plan");
    expect(result.toLowerCase()).toContain("plan");
  });
});
