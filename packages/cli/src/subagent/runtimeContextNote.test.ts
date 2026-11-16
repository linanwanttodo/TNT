import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMeasuredRequests,
  recordMeasuredRequest,
} from "../compaction/measuredContext.js";
import { getSessionTeamRuns } from "../session/index.js";

import {
  clearLiveSubagentRuns,
  noteSubagentRunStarted,
  noteSubagentRunFinished,
} from "./liveRuns.js";
import { runtimeContextNote } from "./runtimeContextNote.js";

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({ sessionId: "t1" })),
  getSessionTeamRuns: vi.fn(() => []),
}));

const MODEL = { contextLength: 200_000, provider: "openai" } as never;

beforeEach(() => {
  clearMeasuredRequests();
  clearLiveSubagentRuns();
  vi.mocked(getSessionTeamRuns).mockReturnValue([]);
});

function localDate(hour: number, minute = 0): Date {
  return new Date(2026, 10, 15, hour, minute);
}

describe("the runtime context note", () => {
  it("always carries the clock and nothing else on a quiet session", () => {
    const note = runtimeContextNote({ now: localDate(14, 30), model: MODEL });

    expect(note).toContain("Runtime context:");
    expect(note).toContain("2026-11-15 14:30");
    expect(note).toContain("afternoon");
    expect(note).toMatch(/UTC[+-]\d/);
    expect(note).not.toContain("Context window");
    expect(note).not.toContain("Running now");
  });

  it("names the period of day across its boundaries", () => {
    const period = (hour: number) =>
      runtimeContextNote({ now: localDate(hour) });

    expect(period(3)).toContain("night");
    expect(period(9)).toContain("morning");
    expect(period(14)).toContain("afternoon");
    expect(period(20)).toContain("evening");
    expect(period(23)).toContain("night");
  });

  it("reports the window from the provider's last measurement", () => {
    recordMeasuredRequest("tnt-t1", {
      promptTokens: 45_000,
      historyLength: 3,
      prefixKey: "tnt-t1",
    });

    const note = runtimeContextNote({ now: localDate(9), model: MODEL });

    expect(note).toContain(
      "Context window: about 45000 of 200000 tokens used (23%)",
    );
  });

  it("stays quiet about the window before any measurement exists", () => {
    const note = runtimeContextNote({ now: localDate(9), model: MODEL });

    expect(note).not.toContain("Context window");
  });

  it("lists live dispatches and a running team", () => {
    const first = noteSubagentRunStarted("explore");
    noteSubagentRunStarted("explore");
    vi.mocked(getSessionTeamRuns).mockReturnValue([
      {
        runId: "r1",
        team: "docs",
        goal: "write docs",
        mode: "parallel",
        startedAt: new Date().toISOString(),
        status: "running",
        members: [
          { name: "writer", status: "completed" },
          { name: "editor", status: "running" },
          { name: "reader", status: "running" },
        ],
      },
    ]);

    const note = runtimeContextNote({ now: localDate(9) });

    expect(note).toContain("2 subagent dispatches running (2 explore)");
    expect(note).toContain(
      'team "docs" run active (2 of 3 members working, mode parallel)',
    );

    noteSubagentRunFinished(first);
    clearLiveSubagentRuns();
    vi.mocked(getSessionTeamRuns).mockReturnValue([]);
  });

  it("says nothing about tasks when nothing runs", () => {
    clearLiveSubagentRuns();

    expect(runtimeContextNote({ now: localDate(9) })).not.toContain(
      "Running now",
    );
  });

  it("is composed at every served prompt, so no surface loses it", () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    for (const file of [
      "ui/hooks/useChat.ts",
      "commands/chat.ts",
      "commands/serve.helpers.ts",
    ]) {
      const source = fs.readFileSync(path.join(root, file), "utf-8");
      expect(source, file).toContain("runtimeContextNote(");
    }
  });
});
