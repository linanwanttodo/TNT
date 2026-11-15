import type { Tool, ToolRunResult } from "../src/tools/types.js";

/**
 * Runs a text-only tool and fails if it ever answers with media, so a test
 * that reads the answer as a string proves the contract it relies on.
 */
export function textRun(
  tool: Pick<Tool, "run" | "name">,
): (args: any) => Promise<string> {
  return async (args: any): Promise<string> => {
    const result: ToolRunResult = await tool.run(args);
    if (typeof result !== "string") {
      throw new Error(`${tool.name} returned an object result, not text.`);
    }
    return result;
  };
}
