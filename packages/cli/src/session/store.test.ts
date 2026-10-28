import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import type { ChatHistoryItem, Session } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InvalidSessionIdError,
  getLegacySessionPath,
  getLegacySessionScopedDir,
  getLegacySessionsListPath,
  getSessionLeasePath,
  getSessionRoot,
  getTranscriptPath,
} from "./paths.js";
import { SessionLeaseError, SessionStoreError, sessionStore } from "./store.js";

let previousGlobalDir: string | undefined;
let previousTntDir: string | undefined;
let previousCliTest: string | undefined;
let testRoot: string;

function user(text: string): ChatHistoryItem {
  return {
    message: { role: "user", content: text },
    contextItems: [],
  } as ChatHistoryItem;
}

function assistant(text: string): ChatHistoryItem {
  return {
    message: { role: "assistant", content: text },
    contextItems: [],
  } as ChatHistoryItem;
}

function toolMessage(): ChatHistoryItem {
  return {
    message: { role: "assistant", content: "" },
    contextItems: [],
    toolCallStates: [{ toolCallId: "call-1", status: "calling", output: [] }],
  } as unknown as ChatHistoryItem;
}

function makeSession(
  history: ChatHistoryItem[],
  overrides: Partial<Session> = {},
): Session {
  return {
    sessionId: randomUUID(),
    title: "Test Session",
    workspaceDirectory: process.cwd(),
    history,
    usage: {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      promptTokensDetails: { cachedTokens: 0, cacheWriteTokens: 0 },
    },
    ...overrides,
  };
}

function contents(session: Session): string[] {
  return session.history.map((item) => String(item.message.content));
}

beforeEach(() => {
  previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  previousTntDir = process.env.TNT_GLOBAL_DIR;
  previousCliTest = process.env.TNT_TEST;
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-session-store-"));
  process.env.TNT_GLOBAL_DIR = testRoot;
  delete process.env.TNT_GLOBAL_DIR;
  delete process.env.TNT_TEST;
  sessionStore.clearAll();
});

afterEach(() => {
  sessionStore.releaseAll();
  fs.rmSync(testRoot, { recursive: true, force: true });
  if (previousGlobalDir === undefined) delete process.env.TNT_GLOBAL_DIR;
  else process.env.TNT_GLOBAL_DIR = previousGlobalDir;
  if (previousTntDir === undefined) delete process.env.TNT_GLOBAL_DIR;
  else process.env.TNT_GLOBAL_DIR = previousTntDir;
  if (previousCliTest === undefined) delete process.env.TNT_TEST;
  else process.env.TNT_TEST = previousCliTest;
});

describe("SessionStore", () => {
  it("round-trips a session through an append-only transcript", () => {
    const session = makeSession([user("hello"), assistant("hi")]);
    sessionStore.ensureSession(session, {
      source: "acp",
      persistEmpty: true,
    });

    const loaded = sessionStore.load(session.sessionId);

    expect(loaded?.origin).toBe("v2");
    expect(contents(loaded!.session)).toEqual(["hello", "hi"]);
    expect(loaded?.meta.source).toBe("acp");
    expect(loaded?.meta.title).toBe("Test Session");
    expect(fs.existsSync(getTranscriptPath(session.sessionId))).toBe(true);
  });

  it("appends new messages without rewriting earlier lines", () => {
    const session = makeSession([user("one")]);
    sessionStore.ensureSession(session, { persistEmpty: true });
    const first = fs.readFileSync(
      getTranscriptPath(session.sessionId),
      "utf-8",
    );

    const next = {
      ...session,
      history: [...session.history, assistant("two")],
    };
    sessionStore.sync(next);

    const after = fs.readFileSync(
      getTranscriptPath(session.sessionId),
      "utf-8",
    );
    expect(after.startsWith(first)).toBe(true);
    expect(contents(sessionStore.load(session.sessionId)!.session)).toEqual([
      "one",
      "two",
    ]);
    expect(sessionStore.getMeta(session.sessionId)?.entryCount).toBe(2);
  });

  it("records a tool-state change as a patch and projects it on load", () => {
    const call = toolMessage();
    const session = makeSession([user("run"), call]);
    sessionStore.ensureSession(session, { persistEmpty: true });

    const updated = {
      ...call,
      toolCallStates: [
        {
          toolCallId: "call-1",
          status: "done",
          output: [{ content: "result", name: "Tool Result" }],
        },
      ],
    } as unknown as ChatHistoryItem;
    sessionStore.sync({ ...session, history: [session.history[0], updated] });

    const loaded = sessionStore.load(session.sessionId)!;
    expect(loaded.session.history[1]?.toolCallStates?.[0]?.status).toBe("done");
    const raw = fs.readFileSync(getTranscriptPath(session.sessionId), "utf-8");
    expect(raw).toContain('"type":"message-patch"');
  });

  it("appends a compaction record but keeps the older bodies", () => {
    const first = user("one");
    const second = assistant("two");
    const third = user("three");
    const session = makeSession([first, second, third]);
    sessionStore.ensureSession(session, { persistEmpty: true });

    const summary = {
      ...user("summary"),
      conversationSummary: "summary",
    } as ChatHistoryItem;
    const compacted = {
      ...session,
      history: [summary, third],
    };
    sessionStore.sync(compacted);

    const loaded = sessionStore.load(session.sessionId)!;
    expect(contents(loaded.session)).toEqual(["summary", "three"]);
    const raw = fs.readFileSync(getTranscriptPath(session.sessionId), "utf-8");
    expect(raw).toContain('"type":"compaction"');
    expect(raw).toContain('"content":"one"');
    expect(raw).toContain('"content":"two"');
  });

  it("rewinds to a message and clears to an empty transcript", () => {
    const first = user("one");
    const second = assistant("two");
    const session = makeSession([first, second]);
    sessionStore.ensureSession(session, { persistEmpty: true });

    sessionStore.sync({ ...session, history: [first] });
    expect(contents(sessionStore.load(session.sessionId)!.session)).toEqual([
      "one",
    ]);

    sessionStore.sync({ ...session, history: [] });
    expect(contents(sessionStore.load(session.sessionId)!.session)).toEqual([]);
  });

  it("lists by cwd, hides subagents, and can include empty sessions", () => {
    const projectA = makeSession([user("a")], {
      workspaceDirectory: "/project-a",
    });
    const projectB = makeSession([user("b")], {
      workspaceDirectory: "/project-b",
    });
    const child = makeSession([user("child")], {
      workspaceDirectory: "/project-a",
      parentSessionId: projectA.sessionId,
      subagentType: "Explore",
    });
    const empty = makeSession([], { workspaceDirectory: "/project-a" });

    for (const session of [projectA, projectB, child]) {
      sessionStore.ensureSession(session, { persistEmpty: true });
    }
    sessionStore.ensureSession(empty, {
      source: "acp",
      persistEmpty: true,
    });

    expect(
      sessionStore.list({ cwd: "/project-a" }).map((meta) => meta.sessionId),
    ).toEqual([projectA.sessionId]);
    expect(
      sessionStore
        .list({ cwd: "/project-a", includeEmpty: true })
        .map((meta) => meta.sessionId)
        .sort(),
    ).toEqual([projectA.sessionId, empty.sessionId].sort());
    expect(
      sessionStore
        .list({ parentSessionId: projectA.sessionId, includeSubagents: true })
        .map((meta) => meta.sessionId),
    ).toEqual([child.sessionId]);
  });

  it("refuses a live lease and replaces a stale one", () => {
    const session = makeSession([user("leased")]);
    sessionStore.ensureSession(session, { persistEmpty: true });
    const lock = getSessionLeasePath(session.sessionId);

    // An alive foreign pid, not `1`: init answers to signal 0 on Linux, but on
    // Windows there is no process 1 and the lease looked stale, so the case
    // asserted a refusal that the platform could not see.
    const holder = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    holder.unref();
    fs.writeFileSync(
      lock,
      JSON.stringify({
        pid: holder.pid,
        writerId: "another-process",
        startedAt: new Date().toISOString(),
      }),
    );
    try {
      expect(() => sessionStore.acquireLease(session.sessionId)).toThrow(
        SessionLeaseError,
      );
    } finally {
      holder.kill();
    }

    fs.writeFileSync(
      lock,
      JSON.stringify({
        pid: 2 ** 31 - 1,
        writerId: "dead-process",
        startedAt: new Date().toISOString(),
      }),
    );
    sessionStore.acquireLease(session.sessionId);
    sessionStore.releaseLease(session.sessionId);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("rejects path-shaped session ids", () => {
    expect(() => sessionStore.load("../escape")).toThrow(InvalidSessionIdError);
    expect(() => sessionStore.delete("a/b")).toThrow(InvalidSessionIdError);
  });

  it("fails closed on a corrupt transcript", () => {
    const sessionId = randomUUID();
    fs.mkdirSync(getSessionRoot(sessionId), { recursive: true });
    fs.writeFileSync(getTranscriptPath(sessionId), "[]\n");

    expect(() => sessionStore.load(sessionId)).toThrow(SessionStoreError);
  });

  it("reads a legacy flat session and migrates it on the first save", () => {
    const sessionId = `legacy-${randomUUID()}`;
    const legacy = makeSession([user("old")], { sessionId, title: "Legacy" });
    fs.writeFileSync(getLegacySessionPath(sessionId), JSON.stringify(legacy));
    fs.writeFileSync(
      getLegacySessionsListPath(),
      JSON.stringify([
        {
          sessionId,
          title: "Legacy",
          workspaceDirectory: legacy.workspaceDirectory,
          dateCreated: Date.now(),
        },
      ]),
    );

    const loaded = sessionStore.load(sessionId)!;
    expect(loaded.origin).toBe("legacy");
    expect(contents(loaded.session)).toEqual(["old"]);

    sessionStore.sync({ ...loaded.session, history: [user("new")] });

    expect(fs.existsSync(getTranscriptPath(sessionId))).toBe(true);
    expect(fs.existsSync(getLegacySessionPath(sessionId))).toBe(false);
    expect(fs.existsSync(`${getLegacySessionPath(sessionId)}.legacy`)).toBe(
      true,
    );
    expect(sessionStore.load(sessionId)?.origin).toBe("v2");
  });

  it("deletes the transcript, sidecars and legacy row together", () => {
    const session = makeSession([user("delete me")]);
    sessionStore.ensureSession(session, { persistEmpty: true });
    fs.mkdirSync(path.join(getSessionRoot(session.sessionId), "tool-results"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(getSessionRoot(session.sessionId), "tool-results", "x.txt"),
      "x",
    );
    fs.mkdirSync(getLegacySessionScopedDir("tool-results", session.sessionId), {
      recursive: true,
    });
    fs.writeFileSync(
      getLegacySessionsListPath(),
      JSON.stringify([{ sessionId: session.sessionId }]),
    );

    sessionStore.delete(session.sessionId);

    expect(fs.existsSync(getSessionRoot(session.sessionId))).toBe(false);
    expect(
      fs.existsSync(
        getLegacySessionScopedDir("tool-results", session.sessionId),
      ),
    ).toBe(false);
    expect(fs.readFileSync(getLegacySessionsListPath(), "utf-8")).toBe("[]");
  });
});
