import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, type Locale } from "../../i18n/index.js";
import { displayWidth } from "../subagentTree.js";
import type { SubagentTreeEntry } from "../subagentTree.js";

import { SubagentTree } from "./SubagentTree.js";

const NOW = 1_000_000;

function entry(overrides: Partial<SubagentTreeEntry> = {}): SubagentTreeEntry {
  return {
    id: "agent-1",
    agentType: "Explore",
    status: "running",
    startedAt: NOW,
    ...overrides,
  };
}

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

function linesOf(frame: string): string[] {
  return frame.split("\n");
}

describe("SubagentTree", () => {
  const originalLocale: Locale = getLocale();

  afterEach(() => {
    setLocale(originalLocale);
  });

  it("renders a running agent with its tool and token counts", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({
            lastToolInfo: "Read",
            toolUses: 3,
            tokens: 1200,
          }),
        ]}
        now={() => NOW + 1000}
        columns={100}
      />,
    );

    expect(frame).toContain("└─ Explore");
    expect(frame).toContain("3 tool uses");
    expect(frame).toContain("1.2k tokens");
    expect(frame).toContain("⎿");
    expect(frame).toContain("Read");
  });

  it("reports a finished agent as Done", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[entry({ status: "done", finishedAt: NOW + 500 })]}
        now={() => NOW + 1000}
        columns={100}
      />,
    );

    expect(frame).toContain("Done");
    expect(frame).not.toContain("Initializing");
  });

  it("reports a failed agent with its error", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({
            status: "failed",
            finishedAt: NOW + 500,
            error: "model unavailable",
          }),
        ]}
        now={() => NOW + 1000}
        columns={100}
      />,
    );

    expect(frame).toContain("Failed: model unavailable");
  });

  it("draws multiple siblings as a tree with a closing last branch", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({ id: "a", agentType: "Explore", lastToolInfo: "Read" }),
          entry({
            id: "b",
            agentType: "Plan",
            status: "done",
            finishedAt: NOW + 100,
            toolUses: 1,
            tokens: 20,
          }),
          entry({
            id: "c",
            agentType: "Review",
            status: "failed",
            finishedAt: NOW + 200,
            error: "boom",
          }),
        ]}
        now={() => NOW + 1000}
        columns={120}
      />,
    );
    const lines = linesOf(frame);
    const treeLines = lines.filter(
      (line) => line.includes("├─") || line.includes("└─"),
    );

    expect(treeLines).toHaveLength(3);
    expect(treeLines[0]).toContain("├─ Explore");
    expect(treeLines[1]).toContain("├─ Plan");
    expect(treeLines[2]).toContain("└─ Review");
    expect(frame).toContain("│  ⎿");
    expect(frame).toContain("   ⎿");
  });

  it("aligns the continuation gutter under the tree trunk", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({ id: "a", lastToolInfo: "Read" }),
          entry({ id: "b", status: "done", finishedAt: NOW + 100 }),
        ]}
        now={() => NOW + 1000}
        columns={100}
      />,
    );
    const lines = linesOf(frame);
    const nonLastTree = lines.find((line) => line.includes("├─"))!;
    const nonLastContinuation = lines.find((line) => line.includes("│  ⎿"))!;
    const lastTree = lines.find((line) => line.includes("└─"))!;
    const lastContinuation = lines.find(
      (line) => line.includes("   ⎿") && !line.includes("│"),
    )!;

    expect(nonLastContinuation.indexOf("│")).toBe(nonLastTree.indexOf("├"));
    expect(lastContinuation.indexOf("⎿")).toBe(lastTree.indexOf("└") + 3);
  });

  it("keeps a zero token count on the row", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({
            status: "done",
            finishedAt: NOW + 100,
            toolUses: 0,
            tokens: 0,
          }),
        ]}
        now={() => NOW + 1000}
        columns={100}
      />,
    );

    expect(frame).toContain("0 tool uses");
    expect(frame).toContain("0 tokens");
  });

  it("shows a line without the counts when neither is available", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[entry({ status: "done", finishedAt: NOW + 100 })]}
        now={() => NOW + 1000}
        columns={100}
      />,
    );

    expect(frame).toContain("Explore");
    expect(frame).toContain("Done");
    expect(frame).not.toContain("tool use");
    expect(frame).not.toContain("tokens");
  });

  it("truncates a long name to the available width", () => {
    const longName = "very-long-delegated-agent-name-".repeat(4);
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({
            agentType: longName,
            description: "a task description that also runs long",
            lastToolInfo:
              "Reading a very long file path that cannot fit on one line",
            toolUses: 12,
            tokens: 34_000,
          }),
        ]}
        now={() => NOW + 1000}
        columns={40}
      />,
    );

    expect(frame).not.toContain(longName);
    for (const line of linesOf(frame)) {
      expect(displayWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  it("folds a finished agent into a one-line summary after the window", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({
            status: "done",
            finishedAt: NOW,
            toolUses: 4,
            tokens: 200,
          }),
        ]}
        now={() => NOW + 30_000}
        columns={100}
      />,
    );

    expect(frame).toContain("1 subagent finished");
    expect(frame).not.toContain("└─");
    expect(frame).not.toContain("4 tool uses");
  });

  it("counts a failed agent in the folded summary", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[
          entry({ id: "a", status: "done", finishedAt: NOW }),
          entry({ id: "b", status: "failed", finishedAt: NOW }),
        ]}
        now={() => NOW + 30_000}
        columns={100}
      />,
    );

    expect(frame).toContain("2 subagents finished");
    expect(frame).toContain("1 failed");
  });

  it("folds recently finished agents when the turn is over", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[entry({ status: "done", finishedAt: NOW + 100 })]}
        active={false}
        now={() => NOW + 1000}
        columns={100}
      />,
    );

    expect(frame).toContain("1 subagent finished");
    expect(frame).not.toContain("Done");
  });

  it("keeps a running agent while the parent turn is over", () => {
    const frame = frameOf(
      <SubagentTree
        entries={[entry({ lastToolInfo: "Grep" })]}
        active={false}
        now={() => NOW + 5000}
        columns={100}
      />,
    );

    expect(frame).toContain("└─ Explore");
    expect(frame).toContain("Grep");
  });

  it("follows the active locale", () => {
    setLocale("zh-CN");

    const frame = frameOf(
      <SubagentTree
        entries={[entry({ status: "done", finishedAt: NOW + 100 })]}
        now={() => NOW + 1000}
        columns={100}
      />,
    );

    expect(frame).toContain("已完成");
  });
});
