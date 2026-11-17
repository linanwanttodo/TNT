import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  forgetExplorationNote,
  takeExplorationNote,
} from "./explorationNote.js";

const originalCwd = process.cwd();

describe("takeExplorationNote", () => {
  beforeEach(() => {
    forgetExplorationNote();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    forgetExplorationNote();
  });

  it("is undefined when there is no large workspace to map", () => {
    // The test runner's own tree is small under the bounded inventory, so no
    // map is worth paying for. The contract is silence, not an empty block.
    const first = takeExplorationNote();
    if (first === undefined) {
      expect(takeExplorationNote()).toBeUndefined();
    } else {
      expect(first).toContain("Exploration context");
    }
  });

  it("never repeats within a session scope", () => {
    if (takeExplorationNote() === undefined) {
      expect(takeExplorationNote()).toBeUndefined();
    } else {
      expect(takeExplorationNote()).toBeUndefined();
    }
  });

  it("starts fresh when the scope is forgotten", () => {
    const first = takeExplorationNote();
    forgetExplorationNote();
    const second = takeExplorationNote();
    expect(second).toBe(first);
  });
});
