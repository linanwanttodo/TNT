import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import historyManager from "./history.js";
import { getSessionFilePath, getSessionsListPath } from "./paths.js";

/**
 * `delete` is the only place that takes a conversation's file and its
 * `sessions.json` row together, and a caller that unlinks by hand leaves the row
 * behind - which is how a session kept being listed after it was cleared. The
 * row-removal half had no assertion at all, so it is pinned here against the real
 * files, at the paths the harness resolves.
 */
describe("deleting a session", () => {
  const sessionId = `delete-round-trip-${process.pid}`;
  const otherId = "another-session";

  const writeSession = (id: string) => {
    fs.mkdirSync(path.dirname(getSessionFilePath(id)), { recursive: true });
    fs.writeFileSync(
      getSessionFilePath(id),
      JSON.stringify({ sessionId: id, title: id, history: [] }),
    );
  };
  const writeIndex = (ids: string[]) =>
    fs.writeFileSync(
      getSessionsListPath(),
      JSON.stringify(
        ids.map((id) => ({
          sessionId: id,
          title: id,
          workspaceDirectory: process.cwd(),
          dateCreated: Date.now(),
        })),
      ),
    );

  beforeEach(() => {
    fs.rmSync(getSessionFilePath(sessionId), { force: true });
    fs.rmSync(getSessionFilePath(otherId), { force: true });
    writeIndex([sessionId, otherId]);
    writeSession(sessionId);
    writeSession(otherId);
  });

  afterEach(() => {
    fs.rmSync(getSessionFilePath(sessionId), { force: true });
    fs.rmSync(getSessionFilePath(otherId), { force: true });
  });

  it("removes the file and the index row together", () => {
    historyManager.delete(sessionId);

    expect(fs.existsSync(getSessionFilePath(sessionId))).toBe(false);
    const rows = JSON.parse(fs.readFileSync(getSessionsListPath(), "utf-8"));
    expect(rows.map((row: any) => row.sessionId)).toEqual([otherId]);
    expect(historyManager.list({}).map((session) => session.sessionId)).toEqual(
      [otherId],
    );
  });

  it("refuses when there is no session file, and leaves the index alone", () => {
    fs.rmSync(getSessionFilePath(sessionId), { force: true });

    expect(() => historyManager.delete(sessionId)).toThrow(/does not exist/i);
    const rows = JSON.parse(fs.readFileSync(getSessionsListPath(), "utf-8"));
    expect(rows.map((row: any) => row.sessionId)).toEqual([sessionId, otherId]);
  });
});
