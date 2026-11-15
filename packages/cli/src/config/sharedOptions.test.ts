import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { mergeParentOptions } from "./sharedOptions.js";

describe("mergeParentOptions", () => {
  it("inherits the step cap for subcommands", () => {
    const program = new Command();
    program.option("--max-steps <count>", "cap", (value) =>
      Number.parseInt(value, 10),
    );
    program.parse(["node", "tnt", "--max-steps", "7"]);

    const merged = mergeParentOptions(program, {});

    expect(merged.maxSteps).toBe(7);
  });
});
