import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "core/index.js";

import {
  getCurrentSession,
  listSessions,
  listSubagentSessions,
  saveSubagentSession,
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
});
