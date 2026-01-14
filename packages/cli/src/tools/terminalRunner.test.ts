import { afterEach, describe, expect, it } from "vitest";

import { runTerminalCommandTool } from "./runTerminalCommand.js";
import {
  getTerminalRunner,
  setTerminalRunner,
  type TerminalRunner,
} from "./terminalRunner.js";

afterEach(() => {
  setTerminalRunner(null);
});

describe("terminal runner registry", () => {
  it("installs and clears the active runner", () => {
    const runner: TerminalRunner = {
      run: async () => ({ output: "", timedOut: false }),
    };
    expect(getTerminalRunner()).toBeNull();
    setTerminalRunner(runner);
    expect(getTerminalRunner()).toBe(runner);
    setTerminalRunner(null);
    expect(getTerminalRunner()).toBeNull();
  });

  it("reports a client-terminal background job with its job id", async () => {
    setTerminalRunner({
      run: async () => ({
        output: "partial\n",
        timedOut: true,
        backgroundJobId: "bg-1-1",
      }),
    });

    const output = await runTerminalCommandTool.run!({
      command: "npm run dev",
    });

    expect(output).toContain("Command moved to background");
    expect(output).toContain("bg-1-1");
    expect(output).toContain("partial");
    expect(output).not.toContain("timed out");
  });
});
