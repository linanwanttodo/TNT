import { readFileSync } from "fs";

import { describe, expect, it, vi } from "vitest";

import {
  HEADLESS_DEFAULT_TIMEOUT_SECONDS,
  armTimeout,
  resolveTimeoutSeconds,
} from "./headlessTimeout.js";

describe("the headless deadline setting", () => {
  it("falls back to the default when nothing usable is given", () => {
    expect(resolveTimeoutSeconds(undefined)).toBe(
      HEADLESS_DEFAULT_TIMEOUT_SECONDS,
    );
    expect(resolveTimeoutSeconds("")).toBe(HEADLESS_DEFAULT_TIMEOUT_SECONDS);
    expect(resolveTimeoutSeconds("abc")).toBe(HEADLESS_DEFAULT_TIMEOUT_SECONDS);
    expect(resolveTimeoutSeconds("-5")).toBe(HEADLESS_DEFAULT_TIMEOUT_SECONDS);
  });

  it("keeps a usable value, including the zero that means no deadline", () => {
    expect(resolveTimeoutSeconds("45")).toBe(45);
    expect(resolveTimeoutSeconds("0")).toBe(0);
  });
});

describe("arming the deadline", () => {
  it("reports and aborts once the seconds pass", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fired: boolean[] = [];
    const cancel = armTimeout(controller, 2, () => {
      fired.push(true);
    });

    vi.advanceTimersByTime(1000);
    expect(fired.length).toBe(0);
    expect(controller.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(fired.length).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    cancel();
    vi.useRealTimers();
  });

  it("cancels before the deadline and then never fires", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fired: boolean[] = [];
    const cancel = armTimeout(controller, 2, () => {
      fired.push(true);
    });

    cancel();
    vi.advanceTimersByTime(5000);
    expect(fired.length).toBe(0);
    expect(controller.signal.aborted).toBe(false);
    vi.useRealTimers();
  });

  it("arms nothing for a non-positive deadline", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fired: boolean[] = [];
    armTimeout(controller, 0, () => {
      fired.push(true);
    });

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fired.length).toBe(0);
    expect(controller.signal.aborted).toBe(false);
    vi.useRealTimers();
  });
});

describe("the headless stream call is the one holding the deadline", () => {
  // The mechanism above is pure; this pins that the run actually uses it, the
  // same way the other source-shape guards read the function that keeps the
  // promise rather than the whole file.
  const source = readFileSync(new URL("./chat.ts", import.meta.url), "utf-8");
  const body = source.slice(
    source.indexOf("async function getStreamingResponse"),
    source.indexOf("// Helper function to process and output response"),
  );

  it("arms the deadline on the controller it passes to the loop", () => {
    expect(body).toContain("armTimeout(abortController");
    expect(body).toContain("cancelTimeout()");
  });

  it("names the timeout to the user instead of returning a silent truncation", () => {
    expect(body).toContain('t("chat.timedOut"');
  });

  it("lets the flag win over the environment setting", () => {
    expect(body).toContain("timeoutSeconds ?? resolveTimeoutSeconds");
  });
});
