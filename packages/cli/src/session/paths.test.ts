import path from "path";

import { describe, expect, it } from "vitest";

import {
  assertSessionId,
  fsSessionName,
  getLegacySessionPath,
  getSessionDir,
  getSessionRoot,
  getTranscriptPath,
  InvalidSessionIdError,
} from "./paths.js";

describe("session id validation", () => {
  it("accepts the id shapes the CLI produces", () => {
    expect(() =>
      assertSessionId("b14c0a71-1f43-4a5e-9c2d-0e8f1a2b3c4d"),
    ).not.toThrow();
    expect(() => assertSessionId("b14c0a71-1f43:9c2d")).not.toThrow();
    expect(() => assertSessionId("sess_01")).not.toThrow();
  });

  it.each([
    "relative/escape",
    "back\\slash",
    "..",
    ".",
    "../..",
    "../../etc/passwd",
    "",
    "id with space",
    "id;rm -rf",
    `${"a".repeat(129)}`,
  ])("rejects %j", (bad) => {
    expect(() => assertSessionId(bad)).toThrow(InvalidSessionIdError);
  });
});

describe("fsSessionName", () => {
  it("keeps a plain id unchanged", () => {
    expect(fsSessionName("b14c0a71")).toBe("b14c0a71");
  });

  it("sanitises the delegated colon shape and pins it with a hash", () => {
    // The colon survives validation (delegated ids are `parent:short`) but
    // not the filesystem-safe rewrite, so the name is hashed over the
    // original id: deterministic, and unable to collide with a plain id.
    const name = fsSessionName("parent:9c2d");
    expect(name).toMatch(/^parent_9c2d-[0-9a-f]{8}$/);
    expect(name).toBe(fsSessionName("parent:9c2d"));
  });

  it("caps an over-long id to a prefix plus its hash", () => {
    const name = fsSessionName("a".repeat(120));
    expect(name).toBe(`${"a".repeat(96)}-${name.split("-").pop()}`);
    expect(name.split("-").pop()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("session paths", () => {
  it("place every artifact under the id's own root in the sessions dir", () => {
    const id = "b14c0a71";
    const sessionsDir = getSessionDir();
    const expectedRoot = path.join(sessionsDir, fsSessionName(id));

    expect(getSessionRoot(id)).toBe(expectedRoot);
    expect(getTranscriptPath(id)).toBe(
      path.join(expectedRoot, "session.jsonl"),
    );
    expect(path.basename(getLegacySessionPath(id))).toBe(`${id}.json`);
    // A traversal attempt cannot move the root out of the sessions dir:
    // the id is rejected before it is ever joined.
    expect(() => getSessionRoot("../../escape")).toThrow(InvalidSessionIdError);
    expect(() => getLegacySessionPath("../../escape")).toThrow(
      InvalidSessionIdError,
    );
  });

  it("keeps the transcript file name fixed", () => {
    expect(path.basename(getTranscriptPath("b14c0a71"))).toBe("session.jsonl");
  });
});
