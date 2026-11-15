import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import {
  composeSubagentCounts,
  composeSubagentRowText,
  DEFAULT_COLLAPSE_AFTER_MS,
  deriveSubagentUsage,
  displayWidth,
  formatTokenCount,
  selectSubagentTreeEntries,
  treeContinuationPrefix,
  treeRowPrefix,
  truncateToWidth,
  type SubagentRowLabels,
  type SubagentTreeEntry,
} from "./subagentTree.js";

const labels: SubagentRowLabels = {
  toolUses: (count) => `${count} tool use${count === 1 ? "" : "s"}`,
  tokens: (count) => `${count} tokens`,
};

function entry(overrides: Partial<SubagentTreeEntry> = {}): SubagentTreeEntry {
  return {
    id: "agent-1",
    agentType: "Explore",
    status: "running",
    startedAt: 1_000,
    ...overrides,
  };
}

function assistant(
  overrides: Partial<ChatHistoryItem["message"]> = {},
  item: Partial<ChatHistoryItem> = {},
): ChatHistoryItem {
  return {
    message: { role: "assistant", content: "", ...overrides } as any,
    contextItems: [],
    ...item,
  };
}

describe("subagent tree glyphs", () => {
  it("closes the branch on the last sibling", () => {
    expect(treeRowPrefix(false)).toBe("├─ ");
    expect(treeRowPrefix(true)).toBe("└─ ");
  });

  it("keeps the trunk on a non-last continuation and clears it on the last", () => {
    expect(treeContinuationPrefix(false)).toBe("│  ⎿  ");
    expect(treeContinuationPrefix(true)).toBe("   ⎿  ");
  });

  it("starts the continuation gutter in the trunk column", () => {
    expect(treeContinuationPrefix(false).startsWith("│")).toBe(true);
    expect(treeContinuationPrefix(true).startsWith(" ")).toBe(true);
    expect(treeContinuationPrefix(false).indexOf("⎿")).toBe(3);
    expect(treeContinuationPrefix(true).indexOf("⎿")).toBe(3);
  });
});

describe("selectSubagentTreeEntries", () => {
  const running = entry({ id: "running", status: "running" });
  const done = entry({
    id: "done",
    status: "done",
    finishedAt: 2_000,
  });
  const failed = entry({
    id: "failed",
    status: "failed",
    finishedAt: 2_000,
  });

  it("keeps running and background agents visible regardless of age", () => {
    const background = entry({ id: "bg", status: "background" });
    const view = selectSubagentTreeEntries([running, background], {
      now: 9_000_000,
      active: false,
    });

    expect(view.visible.map((item) => item.id)).toEqual(["running", "bg"]);
    expect(view.collapsed).toEqual([]);
  });

  it("keeps a recently finished agent while the turn is active", () => {
    const view = selectSubagentTreeEntries([done, failed], {
      now: 2_000 + DEFAULT_COLLAPSE_AFTER_MS - 1,
      active: true,
    });

    expect(view.visible.map((item) => item.id)).toEqual(["done", "failed"]);
    expect(view.collapsed).toEqual([]);
  });

  it("folds an agent whose finish has aged past the window", () => {
    const view = selectSubagentTreeEntries([done], {
      now: 2_000 + DEFAULT_COLLAPSE_AFTER_MS,
      active: true,
    });

    expect(view.visible).toEqual([]);
    expect(view.collapsed.map((item) => item.id)).toEqual(["done"]);
  });

  it("folds finished agents as soon as the turn ends", () => {
    const view = selectSubagentTreeEntries([done], {
      now: 2_100,
      active: false,
    });

    expect(view.visible).toEqual([]);
    expect(view.collapsed.map((item) => item.id)).toEqual(["done"]);
  });
});

describe("subagent row text", () => {
  it("appends tool and token counts when both are known", () => {
    const text = composeSubagentRowText(
      entry({ toolUses: 3, tokens: 1200, description: "map auth" }),
      labels,
    );

    expect(text).toBe("Explore (map auth) · 3 tool uses · 1200 tokens");
  });

  it("keeps a zero token count instead of hiding it", () => {
    const text = composeSubagentRowText(
      entry({ toolUses: 0, tokens: 0 }),
      labels,
    );

    expect(text).toContain("0 tool uses");
    expect(text).toContain("0 tokens");
  });

  it("omits only the counts that are unknown", () => {
    expect(composeSubagentCounts(entry({ tokens: 42 }), labels)).toBe(
      " · 42 tokens",
    );
    expect(composeSubagentCounts(entry({ toolUses: 2 }), labels)).toBe(
      " · 2 tool uses",
    );
    expect(composeSubagentCounts(entry({}), labels)).toBe("");
  });

  it("drops the counters for a backgrounded agent", () => {
    const counts = composeSubagentCounts(
      entry({ status: "background", toolUses: 9, tokens: 9_000 }),
      labels,
    );

    expect(counts).toBe("");
  });
});

describe("formatTokenCount", () => {
  it("prints small counts plainly and compacts the rest", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1_000)).toBe("1k");
    expect(formatTokenCount(1_321)).toBe("1.3k");
    expect(formatTokenCount(15_000)).toBe("15k");
    expect(formatTokenCount(2_500_000)).toBe("2.5m");
  });
});

describe("deriveSubagentUsage", () => {
  it("counts tool calls and adds the latest input to cumulative output", () => {
    const history = [
      {
        message: { role: "user", content: "go" },
        contextItems: [],
      } as ChatHistoryItem,
      assistant({
        toolCalls: [{}, {}] as any,
        usage: { promptTokens: 100, completionTokens: 20 },
      }),
      assistant({
        toolCalls: [{}] as any,
        usage: { promptTokens: 150, completionTokens: 30 },
      }),
    ];

    expect(deriveSubagentUsage(history)).toEqual({
      toolUses: 3,
      tokens: 200,
    });
  });

  it("falls back to toolCallStates when the message has no toolCalls", () => {
    const history = [
      assistant(
        { usage: { promptTokens: 10, completionTokens: 5 } },
        { toolCallStates: [{}, {}, {}] as any },
      ),
    ];

    expect(deriveSubagentUsage(history)).toEqual({
      toolUses: 3,
      tokens: 15,
    });
  });

  it("reports tokens as unknown when no assistant usage exists", () => {
    const history = [assistant({ toolCalls: [{}] as any })];

    expect(deriveSubagentUsage(history)).toEqual({
      toolUses: 1,
      tokens: null,
    });
  });

  it("keeps an explicit zero usage as zero rather than unknown", () => {
    const history = [
      assistant({
        usage: { promptTokens: 0, completionTokens: 0 },
      }),
    ];

    expect(deriveSubagentUsage(history)).toEqual({
      toolUses: 0,
      tokens: 0,
    });
  });
});

describe("width helpers", () => {
  it("counts CJK characters as two columns", () => {
    expect(displayWidth("agent")).toBe(5);
    expect(displayWidth("子代理")).toBe(6);
  });

  it("clips at the column budget without splitting a wide character", () => {
    expect(truncateToWidth("abcdef", 4)).toBe("abcd");
    expect(truncateToWidth("子代理", 5)).toBe("子代");
    expect(truncateToWidth("short", 10)).toBe("short");
    expect(truncateToWidth("anything", 0)).toBe("");
  });
});
