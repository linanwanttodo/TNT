import { describe, expect, it } from "vitest";

import { classifyChecksArgument } from "./checksArgs.js";

const url = "https://github.com/o/r/pull/7";

describe("how tnt checks reads its positional arguments", () => {
  it("treats each implemented action as an action, list included", () => {
    expect(classifyChecksArgument("list", undefined)).toEqual({
      action: "list",
      prUrl: undefined,
    });
    expect(classifyChecksArgument("accept", url)).toEqual({
      action: "accept",
      prUrl: url,
    });
    expect(classifyChecksArgument("reject", undefined)).toEqual({
      action: "reject",
      prUrl: undefined,
    });
  });

  it("treats anything else in the first slot as the PR URL", () => {
    expect(classifyChecksArgument(url, undefined)).toEqual({
      action: "list",
      prUrl: url,
    });
    expect(classifyChecksArgument(undefined, url)).toEqual({
      action: "list",
      prUrl: url,
    });
    expect(classifyChecksArgument(undefined, undefined)).toEqual({
      action: "list",
      prUrl: undefined,
    });
  });
});
