import { render } from "ink-testing-library";
import React from "react";

import { AppRoot } from "../ui/AppRoot.js";

import { createUITestContext } from "./ui-test-context.js";

export type TestMode = "local" | "remote";

/**
 * Helper to run a test in both local and remote modes
 * This creates two test suites - one for each mode
 */
// AppRoot mounts the whole TUI, and every component inside it subscribes to the
// shared service container. A case that leaves its tree mounted keeps those
// handlers alive for every later case in the same worker, so a handful of files
// is enough to fill the container's fifty-handler allowance.
const mounted: { unmount: () => void }[] = [];

export function unmountAll(): void {
  for (const tree of mounted) {
    tree.unmount();
  }
  mounted.length = 0;
}

export function testBothModes(
  name: string,
  testFn: (mode: TestMode) => void | Promise<void>,
) {
  describe(`${name} [LOCAL MODE]`, () => {
    let context: any;

    beforeEach(() => {
      context = createUITestContext({
        allServicesReady: true,
        serviceState: "ready",
      });
    });

    afterEach(() => {
      unmountAll();
      context.cleanup();
    });

    it("works in local mode", async () => {
      await testFn("local");
    });
  });

  describe(`${name} [REMOTE MODE]`, () => {
    let context: any;

    beforeEach(() => {
      context = createUITestContext({
        allServicesReady: true,
        serviceState: "ready",
      });
    });

    afterEach(() => {
      unmountAll();
      context.cleanup();
    });

    it("works in remote mode", async () => {
      await testFn("remote");
    });
  });
}

/**
 * Helper to render TUIChat in the specified mode
 */
export function renderInMode(mode: TestMode, props?: any) {
  const tree = render(
    mode === "remote"
      ? React.createElement(AppRoot, {
          remoteUrl: "http://localhost:3000",
          ...props,
        })
      : React.createElement(AppRoot, props),
  );
  mounted.push(tree);
  return tree as ReturnType<typeof render>;
}

/**
 * Helper to run a test in only one mode
 */
export function testSingleMode(
  name: string,
  mode: TestMode,
  testFn: () => void | Promise<void>,
) {
  describe(`${name} [${mode.toUpperCase()} MODE ONLY]`, () => {
    let context: any;

    beforeEach(() => {
      context = createUITestContext({
        allServicesReady: true,
        serviceState: "ready",
      });
    });

    afterEach(() => {
      unmountAll();
      context.cleanup();
    });

    it(`works in ${mode} mode`, async () => {
      await testFn();
    });
  });
}
