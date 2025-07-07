import { describe, expect, it } from "vitest";

import { LoopDetector } from "./loopDetector.js";

describe("LoopDetector", () => {
  it("ignores ordinary prose that reuses a phrase in different places", () => {
    const detector = new LoopDetector();

    detector.feed("Let me check the configuration file for you.\n");
    detector.feed("I will read the file and then summarize what changed.\n");
    detector.feed(
      "To confirm, let me check the configuration file once more.\n",
    );

    expect(detector.finish()).toBeUndefined();
  });

  it("flags the same long line repeated in a row", () => {
    const detector = new LoopDetector();
    const line =
      "npm warn deprecated package@1.0.0 please migrate to the new package name soon";

    detector.feed(`${line}\n${line}\n${line}\n`);

    const detection = detector.finish();
    expect(detection?.kind).toBe("single_message_single_line");
    expect(detection?.repetitions).toBe(3);
    expect(detection?.pattern).toContain("npm warn deprecated");
  });

  it("needs more repetitions inside a code fence", () => {
    const outside = new LoopDetector();
    const line = "x".repeat(120);
    outside.feed(`${line}\n${line}\n${line}\n`);
    expect(outside.finish()).toBeDefined();

    const inside = new LoopDetector();
    const inFence =
      "npm install --legacy-peer-deps --no-audit --no-fund --verbose-flag";
    inside.feed("```bash\n");
    inside.feed(`${inFence}\n${inFence}\n`);
    inside.feed("```\n");
    // Three repetitions inside a fence is below the in-fence threshold.
    expect(inside.finish()).toBeUndefined();
  });

  it("flags a multi-line block repeated back to back", () => {
    const detector = new LoopDetector();
    const block = [
      "function handler(request, response) {",
      "  const payload = parseBody(request);",
      "  response.write(payload);",
      "}",
    ].join("\n");

    detector.feed(`${block}\n${block}\n`);

    const detection = detector.finish();
    expect(detection?.kind).toBe("single_message_multi_line");
    expect(detection?.repetitions).toBe(2);
  });

  it("reports the same fingerprint for the same repetition", () => {
    const line = "error TS2304 cannot find name describe in this scope at all";

    const first = new LoopDetector();
    first.feed(`${line}\n${line}\n${line}\n`);

    const second = new LoopDetector();
    second.feed(`${line}\n${line}\n${line}\n`);

    expect(first.finish()?.fingerprint).toBe(second.finish()?.fingerprint);
  });

  it("detects a repetition that only completes mid-stream", () => {
    const detector = new LoopDetector();
    const line =
      "checking package integrity and resolving the dependency graph now";

    expect(detector.feed(`${line}\n${line}\n`)).toBeUndefined();
    // The third repetition crosses the threshold, and it happens on a chunk.
    expect(detector.feed(`${line}\n`)).toBeDefined();
  });
});
