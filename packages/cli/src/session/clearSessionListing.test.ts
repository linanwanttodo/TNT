import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearSession, getCurrentSession, listSessions } from "./index.js";

/**
 * A cleared conversation used to disappear as a file while its row stayed in
 * `sessions.json`, and the listing showed that row anyway - `tnt ls` offered a
 * session with no history to open. These cases run against the real files in the
 * suite's temporary global dir, because a mocked `fs` cannot tell a stale index
 * row from a deleted session.
 */
const sessionDir = path.join(process.env.TNT_GLOBAL_DIR!, "sessions");
const listPath = path.join(sessionDir, "sessions.json");

function writeSessionFile(sessionId: string): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, `${sessionId}.json`),
    JSON.stringify({
      sessionId,
      title: "a conversation",
      workspaceDirectory: process.cwd(),
      history: [],
    }),
  );
}

function writeIndex(rows: unknown[]): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(listPath, JSON.stringify(rows));
}

describe("a cleared session leaves the listing", () => {
  let filesBefore: string[];
  let listBefore: string | null;

  beforeEach(() => {
    fs.mkdirSync(sessionDir, { recursive: true });
    filesBefore = fs.readdirSync(sessionDir);
    listBefore = fs.existsSync(listPath)
      ? fs.readFileSync(listPath, "utf-8")
      : null;
  });

  afterEach(() => {
    for (const file of fs.readdirSync(sessionDir)) {
      if (!filesBefore.includes(file)) {
        fs.rmSync(path.join(sessionDir, file), { force: true });
      }
    }
    if (listBefore === null) {
      fs.rmSync(listPath, { force: true });
    } else {
      fs.writeFileSync(listPath, listBefore);
    }
  });

  it("drops the index row when the session is cleared", () => {
    const sessionId = getCurrentSession().sessionId;
    writeSessionFile(sessionId);
    writeIndex([
      {
        sessionId,
        title: "a conversation",
        workspaceDirectory: process.cwd(),
        dateCreated: Date.now(),
      },
    ]);

    clearSession();

    expect(fs.existsSync(path.join(sessionDir, `${sessionId}.json`))).toBe(
      false,
    );
    expect(JSON.parse(fs.readFileSync(listPath, "utf-8"))).toEqual([]);
  });

  it("skips a row whose file is gone instead of listing it", async () => {
    writeIndex([
      {
        sessionId: "phantom-session",
        title: "no file behind this",
        workspaceDirectory: process.cwd(),
        dateCreated: Date.now(),
      },
    ]);
    fs.rmSync(path.join(sessionDir, "phantom-session.json"), { force: true });

    const listed = await listSessions();

    expect(listed.map((session) => session.sessionId)).not.toContain(
      "phantom-session",
    );
  });
});
