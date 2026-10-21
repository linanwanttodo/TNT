import { describe, expect, it } from "vitest";

import { formatUsageLines } from "./infoScreen.js";

const base = { totalCost: 0, promptTokens: 0, completionTokens: 0 };

describe("the /info usage block", () => {
  it("shows tokens when a provider reports no price", () => {
    const lines = formatUsageLines({
      ...base,
      promptTokens: 1200,
      completionTokens: 340,
    }).join("\n");

    expect(lines).toContain("1,200");
    expect(lines).toContain("340");
    expect(lines).toContain("1,540");
    expect(lines).not.toContain("No usage data yet");
    expect(lines).not.toContain("Total Cost");
  });

  it("shows the cost when there is one, and nothing when there is none", () => {
    expect(
      formatUsageLines({ ...base, totalCost: 0.031, promptTokens: 10 }).join(
        "\n",
      ),
    ).toContain("$0.031000");
    expect(formatUsageLines(base).join("\n")).toContain("No usage data yet");
  });
});
