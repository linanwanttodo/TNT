import fs from "fs";
import path from "path";

import type { ChatHistoryItem, SessionGoalState } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getCurrentSession,
  listSessions,
  listSubagentSessions,
  loadSession,
  loadSessionById,
  persistSessionGoalState,
  resumeSession,
  saveSubagentSession,
  selectSession,
  setSessionGoal,
  startNewSession,
  updateSessionHistory,
  updateSubagentSession,
} from "./index.js";

/**
 * The neighbouring suite mocks the history manager, and the mock writes whole
 * session objects to disk - so it stayed green while the core serializer
 * dropped the delegation fields on the way out and the child link vanished.
 * These cases run the real writer and the real readers against the worker's
 * temporary global directory.
 */
const sessionDir = path.join(process.env.TNT_GLOBAL_DIR!, "sessions");
const listPath = path.join(sessionDir, "sessions.json");

const childHistory = [
  {
    message: { role: "user", content: "map the auth flow" },
    contextItems: [],
  },
] as unknown as ChatHistoryItem[];

let filesBefore: Set<string>;
let listBefore: string | null;

beforeEach(() => {
  filesBefore = new Set(
    fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir) : [],
  );
  listBefore = fs.existsSync(listPath)
    ? fs.readFileSync(listPath, "utf-8")
    : null;
});

afterEach(() => {
  for (const file of fs.readdirSync(sessionDir)) {
    if (file !== "sessions.json" && !filesBefore.has(file)) {
      fs.rmSync(path.join(sessionDir, file), {
        recursive: true,
        force: true,
      });
    }
  }
  if (listBefore === null) {
    fs.rmSync(listPath, { force: true });
  } else {
    fs.writeFileSync(listPath, listBefore);
  }
});

describe("delegated session persistence", () => {
  it("keeps a delegated run reachable from its parent", () => {
    const child = saveSubagentSession({
      parentSessionId: "root-session",
      subagentType: "Explore",
      history: childHistory,
    });

    const children = listSubagentSessions("root-session");

    expect(children.map((entry) => entry.sessionId)).toEqual([child.sessionId]);
    expect(children[0]?.subagentType).toBe("Explore");
  });

  it("shows the root session and hides the delegated one in the root list", async () => {
    updateSessionHistory(childHistory);
    const rootId = getCurrentSession().sessionId;

    const child = saveSubagentSession({
      parentSessionId: rootId,
      subagentType: "Explore",
      history: childHistory,
    });

    const sessions = await listSessions(100);
    const ids = sessions.map((entry) => entry.sessionId);
    expect(ids).toContain(rootId);
    expect(ids).not.toContain(child.sessionId);
  });

  it("resumes the newest root conversation instead of a delegated run", () => {
    updateSessionHistory(childHistory);
    const rootId = getCurrentSession().sessionId;
    const child = saveSubagentSession({
      parentSessionId: rootId,
      subagentType: "Explore",
      history: childHistory,
    });

    expect(child.parentSessionId).toBe(rootId);
    const resumed = loadSession();

    expect(resumed?.sessionId).toBe(rootId);
  });

  it("does not append the cancellation notice twice when it is not the last item", () => {
    const child = saveSubagentSession({
      parentSessionId: "root-notice",
      subagentType: "Explore",
      history: childHistory,
    });
    const notice = "Subagent execution was cancelled by the user.";

    updateSubagentSession({
      sessionId: child.sessionId,
      history: [
        ...childHistory,
        // The escape handler already recorded the notice, and the aborted run
        // left an assistant item after it.
        {
          message: { role: "user", content: notice },
          contextItems: [],
        },
        {
          message: { role: "assistant", content: "partial work" },
          contextItems: [],
        },
      ] as ChatHistoryItem[],
      notice,
    });

    const reloaded = loadSessionById(child.sessionId);
    expect(
      reloaded?.history.filter((item) => item.message.content === notice),
    ).toHaveLength(1);
  });

  it("reports an unknown session id as missing", () => {
    expect(loadSessionById(`missing-${Date.now()}`)).toBeNull();
  });

  it("selects the requested session and makes later saves follow it", () => {
    updateSessionHistory(childHistory);
    const first = getCurrentSession().sessionId;

    startNewSession([]);
    const second = getCurrentSession().sessionId;
    expect(second).not.toBe(first);

    const selected = selectSession(first);

    expect(selected?.sessionId).toBe(first);
    expect(getCurrentSession().sessionId).toBe(first);
  });

  it("resumes only conversations from the current directory", () => {
    updateSessionHistory(childHistory);
    const mine = getCurrentSession().sessionId;

    // A newer legacy conversation that belongs to another project. It needs a
    // visible message and an index row to be a candidate at all.
    const foreignId = `foreign-${Date.now()}`;
    const foreignPath = path.join(sessionDir, `${foreignId}.json`);
    fs.writeFileSync(
      foreignPath,
      JSON.stringify({
        sessionId: foreignId,
        title: "Other project",
        workspaceDirectory: "/some/other/project",
        history: [
          {
            message: { role: "user", content: "other project work" },
            contextItems: [],
          },
        ],
      }),
    );
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(foreignPath, future, future);
    const rows = listBefore ? JSON.parse(listBefore) : [];
    fs.writeFileSync(
      listPath,
      JSON.stringify([
        ...rows,
        {
          sessionId: foreignId,
          title: "Other project",
          workspaceDirectory: "/some/other/project",
          dateCreated: Date.now(),
        },
      ]),
    );

    expect(loadSession()?.sessionId).toBe(mine);
  });

  it("resumes a requested session, and the newest root without one", () => {
    updateSessionHistory(childHistory);
    const older = getCurrentSession().sessionId;

    startNewSession([]);
    updateSessionHistory(childHistory);
    const newer = getCurrentSession().sessionId;
    // The two writes can land in the same millisecond; make the order explicit
    // in the metadata the list is sorted by.
    const metaPath = path.join(sessionDir, newer, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.updatedAt = new Date(Date.now() + 5_000).toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    expect(resumeSession(older)?.sessionId).toBe(older);
    expect(resumeSession()?.sessionId).toBe(newer);
    expect(resumeSession("missing-id")).toBeNull();
  });
});

describe("goal lifecycle persistence", () => {
  const lifecycle: SessionGoalState = {
    objective: "Ship the feature",
    status: "paused",
    iteration: 3,
    timeUsedSeconds: 42,
    activeRunStartedAtMs: null,
    verifications: [
      { iteration: 2, outcome: "notSatisfied", at: 900, anchorRowId: null },
    ],
    iterations: [
      {
        iteration: 3,
        items: [{ id: "1", content: "Write tests", status: "pending" }],
        updatedAt: 950,
      },
    ],
    createdAt: 100,
    updatedAt: 1_000,
  };

  it("round-trips the observed lifecycle through the store", () => {
    updateSessionHistory(childHistory);
    const sessionId = getCurrentSession().sessionId;
    setSessionGoal("Ship the feature");
    persistSessionGoalState(sessionId, lifecycle);

    const reloaded = loadSessionById(sessionId);

    expect(reloaded?.goal).toBe("Ship the feature");
    expect(reloaded?.goalState).toEqual(lifecycle);
  });

  it("clears the stored lifecycle when the goal is cleared", () => {
    updateSessionHistory(childHistory);
    const sessionId = getCurrentSession().sessionId;
    setSessionGoal("Ship the feature");
    persistSessionGoalState(sessionId, lifecycle);

    setSessionGoal(undefined);

    const reloaded = loadSessionById(sessionId);
    expect(reloaded?.goal).toBeUndefined();
    expect(reloaded?.goalState).toBeUndefined();
  });

  it("restarts the lifecycle when the goal text changes", () => {
    updateSessionHistory(childHistory);
    const sessionId = getCurrentSession().sessionId;
    setSessionGoal("Ship the feature");
    persistSessionGoalState(sessionId, lifecycle);

    setSessionGoal("Ship something else");

    const reloaded = loadSessionById(sessionId);
    expect(reloaded?.goal).toBe("Ship something else");
    expect(reloaded?.goalState).toBeUndefined();
  });
});
