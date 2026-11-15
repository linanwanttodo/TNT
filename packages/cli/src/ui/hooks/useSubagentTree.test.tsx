import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubagentTree } from "../components/SubagentTree.js";

import { useSubagentTree } from "./useSubagentTree.js";

const bus = vi.hoisted(() => {
  const listeners = new Set<(event: unknown) => void>();
  return {
    listeners,
    emit(event: unknown) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    reset() {
      listeners.clear();
    },
  };
});

const session = vi.hoisted(() => ({
  children: [] as Array<{ sessionId: string; subagentType?: string }>,
  loaded: null as { history: unknown[] } | null,
}));

vi.mock("../../protocol/eventBus.js", () => ({
  subscribeAgentEvents: (listener: (event: unknown) => void) => {
    bus.listeners.add(listener);
    return () => {
      bus.listeners.delete(listener);
    };
  },
}));

vi.mock("../../session/index.js", () => ({
  getCurrentSessionId: () => "parent",
  listSubagentSessions: () => session.children,
  loadSessionById: () => session.loaded,
}));

const NOW = 1_000_000;

function event(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: "parent",
    turnId: "Explorer",
    seq: 1,
    timestamp: NOW,
    ...overrides,
  };
}

function Harness({ active = true }: { active?: boolean }) {
  const entries = useSubagentTree({ parentSessionId: "parent" });
  return (
    <SubagentTree
      entries={entries}
      active={active}
      now={() => NOW + 1000}
      columns={100}
    />
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  bus.reset();
  session.children = [];
  session.loaded = null;
});

afterEach(() => {
  bus.reset();
});

describe("useSubagentTree", () => {
  it("renders a delegated run from its lifecycle events", async () => {
    const tree = render(<Harness />);
    try {
      bus.emit(
        event({
          type: "subagent.started",
          agentName: "Explore",
          prompt: "map the auth flow",
        }),
      );
      await tick();

      expect(tree.lastFrame()).toContain("└─ Explore");
      expect(tree.lastFrame()).toContain("map the auth flow");
      expect(tree.lastFrame()).toContain("Initializing");
    } finally {
      tree.unmount();
    }
  });

  it("ignores a run announced for another session", async () => {
    const tree = render(<Harness />);
    try {
      bus.emit(
        event({
          type: "subagent.started",
          sessionId: "other",
          agentName: "Explore",
          prompt: "not ours",
        }),
      );
      await tick();

      expect(tree.lastFrame() ?? "").not.toContain("Explore");
    } finally {
      tree.unmount();
    }
  });

  it("fills a finished run's counters from the saved child transcript", async () => {
    const tree = render(<Harness />);
    try {
      bus.emit(
        event({
          type: "subagent.started",
          agentName: "Explore",
          prompt: "map the auth flow",
        }),
      );
      await tick();

      session.children = [{ sessionId: "child-1", subagentType: "Explore" }];
      session.loaded = {
        history: [
          {
            message: {
              role: "assistant",
              content: "",
              toolCalls: [{}, {}],
              usage: { promptTokens: 120, completionTokens: 30 },
            },
            contextItems: [],
          },
        ],
      };

      bus.emit(
        event({
          type: "subagent.finished",
          agentName: "Explore",
          content: "all done",
          success: true,
        }),
      );
      await tick();

      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("Done");
      expect(frame).toContain("2 tool uses");
      expect(frame).toContain("150 tokens");
    } finally {
      tree.unmount();
    }
  });

  it("marks a failed run with the reported error", async () => {
    const tree = render(<Harness />);
    try {
      bus.emit(
        event({
          type: "subagent.started",
          agentName: "Explore",
          prompt: "map the auth flow",
        }),
      );
      await tick();
      bus.emit(
        event({
          type: "subagent.finished",
          agentName: "Explore",
          content: "model unavailable",
          success: false,
        }),
      );
      await tick();

      expect(tree.lastFrame()).toContain("Failed: model unavailable");
    } finally {
      tree.unmount();
    }
  });
});
