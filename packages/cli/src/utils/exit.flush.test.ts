import { describe, expect, it } from "vitest";

import { flushStream } from "./exit.js";

describe("flushStream", () => {
  it("resolves only after the pending write callback fires", async () => {
    let release: (() => void) | undefined;
    const stream = {
      writableLength: 4,
      write: (_chunk: string, callback?: () => void) => {
        release = callback;
        return true;
      },
    };

    let flushed = false;
    const pending = flushStream(stream, 100).then(() => {
      flushed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(flushed).toBe(false);

    release?.();
    await pending;
    expect(flushed).toBe(true);
  });

  it("resolves on its own when the stream never calls back", async () => {
    const started = Date.now();
    await flushStream({ writableLength: 4, write: () => true }, 20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("resolves immediately when nothing is buffered", async () => {
    await expect(
      flushStream({ writableLength: 0, write: () => true }, 100),
    ).resolves.toBeUndefined();
  });
});
