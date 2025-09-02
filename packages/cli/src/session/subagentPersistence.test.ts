import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "core/index.js";

import {
  getCurrentSession,
  listSessions,
  listSubagentSessions,
  loadSession,
  loadSessionById,
  resumeSession,
  saveSubagentSession,
  selectSession,
  startNewSession,
  updateSessionHistory,
} from "./index.js";

/**
 * The neighbouring suite mocks the history manager, and the mock writes whole
 * session objects to disk - so it stayed green while the core serializer
 * dropped the delegation fields on the way out and the child link vanished.
 * These cases run the real writer and the real readers against the worker's
 * temporary global directory.
 */
const sessionDir = path.join(process.env.CONTINUE_GLOBAL_DIR!, "sessions");

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
  const listPath = path.join(sessionDir, "sessions.json");
  listBefore = fs.existsSync(listPath)
    ? fs.readFileSync(listPath, "utf-8")
    : null;
});

afterEach(() => {
  const listPath = path.join(sessionDir, "sessions.json");
  for (const file of fs.readdirSync(sessionDir)) {
    if (file !== "sessions.json" && !filesBefore.has(file)) {
      fs.rmSync(path.join(sessionDir, file), { force: true });
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

    // Make the child strictly newer so the pick would land on it without the
    // root-only filter.
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(
      path.join(sessionDir, `${child.sessionId}.json`),
      future,
      future,
    );

    const resumed = loadSession();

    expect(resumed?.sessionId).toBe(rootId);
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

    // A newer conversation that belongs to another project.
    const foreignId = `foreign-${Date.now()}`;
    const foreignPath = path.join(sessionDir, `${foreignId}.json`);
    fs.writeFileSync(
      foreignPath,
      JSON.stringify({
        sessionId: foreignId,
        title: "Other project",
        workspaceDirectory: "/some/other/project",
        history: [],
      }),
    );
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(foreignPath, future, future);

    expect(loadSession()?.sessionId).toBe(mine);
  });

  it("resumes a requested session, and the newest root without one", () => {
    updateSessionHistory(childHistory);
    const older = getCurrentSession().sessionId;

    startNewSession([]);
    updateSessionHistory(childHistory);
    const newer = getCurrentSession().sessionId;
    // The two writes can land in the same millisecond; make the order explicit.
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(sessionDir, `${newer}.json`), future, future);

    expect(resumeSession(older)?.sessionId).toBe(older);
    expect(resumeSession()?.sessionId).toBe(newer);
    expect(resumeSession("missing-id")).toBeNull();
  });
});
