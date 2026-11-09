import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  conversationDeltaSchema,
  toolCallRowSchema,
} from "@zcode/shared/zcode-protocol-v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  beginTeamRun,
  clearSessionTeamRuns,
  createSession,
  finishTeamMemberRun,
  finishTeamRun,
  startTeamMemberRun,
} from "../session/index.js";
import { sessionStore } from "../session/store.js";
import { buildTeamWorkflowGraph } from "../session/teamWorkflow.js";

import { SessionRuntimeStore } from "./runtime.js";
import type { SessionHandlers } from "./session.js";
import { V4Handlers, type V4TurnTarget } from "./v4.js";

class RecordingSender {
  readonly messages: Array<{
    method?: string;
    params?: {
      frame?: {
        payload?: { kind?: string; deltas?: unknown[] };
      };
    };
  }> = [];

  async send(message: unknown): Promise<void> {
    this.messages.push(message as RecordingSender["messages"][number]);
  }
}

const turns: V4TurnTarget = {
  sendText: async () => 0,
  compact: async () => 0,
  stopSession: async () => undefined,
  deleteSession: async () => undefined,
  isRunning: () => false,
};

function frameDeltas(sender: RecordingSender): unknown[] {
  return sender.messages.flatMap((message) => {
    const payload = message.params?.frame?.payload;
    return payload?.kind === "deltas" ? (payload.deltas ?? []) : [];
  });
}

function toolRows(sender: RecordingSender) {
  return frameDeltas(sender).flatMap((delta) => {
    const record = delta as { op?: string; row?: unknown };
    if (record.op !== "row.appended" && record.op !== "row.upserted") {
      return [];
    }
    const row = record.row as { kind?: string };
    return row?.kind === "toolCall" ? [row] : [];
  });
}

describe("V4 team-run workflow wiring", () => {
  let root: string;
  let previousGlobalDir: string | undefined;
  let sender: RecordingSender;
  let runtimes: SessionRuntimeStore;
  let handlers: V4Handlers;
  let sessionId: string;

  beforeEach(async () => {
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-v4-workflow-"));
    process.env.TNT_GLOBAL_DIR = root;
    sessionStore.clearAll();
    clearSessionTeamRuns();
    const session = createSession([], "session-v4-workflow", {
      source: "serve",
      persistEmpty: true,
    });
    sessionId = session.sessionId;
    sender = new RecordingSender();
    runtimes = new SessionRuntimeStore();
    handlers = new V4Handlers({
      sender,
      runtimes,
      sessions: {} as SessionHandlers,
      turns,
    });
    await handlers.subscribe({
      topic: `conversation/${sessionId}`,
      connectionId: "conn-1",
      clientMode: "desktop-continuous",
    });
  });

  afterEach(() => {
    handlers.dispose();
    clearSessionTeamRuns();
    sessionStore.releaseAll();
    fs.rmSync(root, { recursive: true, force: true });
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
  });

  it("emits workflowRun deltas and the static graph as a run progresses", async () => {
    runtimes.applyAgentEvent({
      sessionId,
      turnId: "turn-1",
      seq: 1,
      timestamp: 1_000,
      type: "tool.started",
      toolCallId: "call-1",
      toolName: "SummonTeam",
      args: { goal: "Ship the feature" },
    });

    const run = beginTeamRun({
      team: "dev",
      goal: "Ship the feature",
      mode: "parallel",
      members: ["implementer", "tester"],
      workflowGraph: buildTeamWorkflowGraph({
        team: "dev",
        goal: "Ship the feature",
        mode: "parallel",
        members: [
          { name: "implementer", description: "Writes the feature" },
          { name: "tester", description: "Verifies the feature" },
        ],
      }),
    });
    await Promise.resolve();

    const afterStart = frameDeltas(sender);
    for (const delta of afterStart) {
      expect(() => conversationDeltaSchema.parse(delta)).not.toThrow();
    }
    const firstUpdate = afterStart.find(
      (delta) => (delta as { op?: string }).op === "workflowRun.updated",
    ) as { revision?: number; actors?: Array<{ status: string }> } | undefined;
    expect(firstUpdate?.revision).toBe(1);
    expect(firstUpdate?.actors?.map((actor) => actor.status)).toEqual([
      "waiting",
      "waiting",
    ]);
    const row = toolRows(sender)
      .filter(
        (candidate) =>
          (candidate as { toolName?: string }).toolName === "SummonTeam",
      )
      .at(-1);
    if (!row) throw new Error("expected a SummonTeam row");
    expect(() => toolCallRowSchema.parse(row)).not.toThrow();
    expect(row).toMatchObject({
      display: {
        kind: "create_workflow",
        causalityGraph: {
          steps: [
            { label: "Writes the feature" },
            { label: "Verifies the feature" },
          ],
          phases: [{ id: "wave-1", name: "wave-1" }],
        },
      },
    });

    startTeamMemberRun(run.runId, "implementer", "cheap-model");
    await Promise.resolve();

    const secondUpdate = frameDeltas(sender)
      .filter(
        (delta) => (delta as { op?: string }).op === "workflowRun.updated",
      )
      .at(-1) as
      | {
          revision?: number;
          actors?: Array<{ status: string; model?: string }>;
          nodes?: Array<{ phase: string }>;
        }
      | undefined;
    expect(secondUpdate?.revision).toBe(2);
    expect(secondUpdate?.actors?.[0]).toMatchObject({
      status: "running",
      model: "cheap-model",
    });
    expect(secondUpdate?.nodes?.[0]).toMatchObject({ phase: "executing" });

    finishTeamMemberRun(run.runId, "implementer", { success: true });
    finishTeamRun(run.runId, "completed");
    await Promise.resolve();

    const updates = frameDeltas(sender).filter(
      (delta) => (delta as { op?: string }).op === "workflowRun.updated",
    ) as Array<{
      revision?: number;
      run?: { status: string };
      nodes?: Array<{ outcome?: string }>;
    }>;
    expect(updates.map((delta) => delta.revision)).toEqual([1, 2, 3, 4]);
    expect(updates.at(-1)?.run?.status).toBe("completed");
    expect(updates.at(-1)?.nodes?.[0]?.outcome).toBe("ok");
    expect(runtimes.workflowRevision(sessionId)).toBe(4);
  });
});
