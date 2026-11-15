import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pressUntil,
  pressUntilMet,
  typeIntoField,
} from "../../test-utils/renderPress.js";
import { setLocale } from "../i18n/index.js";

import { ProviderSetupScreen } from "./ProviderSetupScreen.js";

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const mounted: { unmount: () => void }[] = [];

beforeEach(() => {
  // Every assertion below names the English copy the screen prints.
  setLocale("en");
});

afterEach(() => {
  for (const tree of mounted) tree.unmount();
  mounted.length = 0;
});

function renderScreen() {
  const onComplete = vi.fn();
  const onCancel = vi.fn();
  const tree = render(
    <ProviderSetupScreen onComplete={onComplete} onCancel={onCancel} />,
  );
  mounted.push(tree);
  return { tree, onComplete, onCancel };
}

/** One write, one wait: the screen moves on its own after the chunk. */
async function waitForFrame(
  tree: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(tree.lastFrame() ?? "")) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for the next step`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Enter and the protocol digits set state absolutely, so a lost one is simply
 * sent again. Typed text appends, so it is typed through `typeIntoField`, which
 * clears the field before a retry instead of doubling what is in it.
 */
describe("ProviderSetupScreen", () => {
  it("collects protocol, base URL, key and model in one box", async () => {
    const { tree, onComplete } = renderScreen();

    await pressUntil(tree, "5", (frame) => frame.includes("❯ 5)"));
    await pressUntil(tree, "\r", (frame) => frame.includes("Base URL"));
    // The URL is prefilled for the preset: the reader sees it and presses
    // Enter to accept, or types to replace it.
    expect(tree.lastFrame() ?? "").toContain("http://localhost:11434/v1/");

    // Clear the prefilled URL and type a custom one.
    tree.stdin.write("\u0015"); // Ctrl+U clears the field.
    await tick(50);
    tree.stdin.write("http://127.0.0.1:8080/v1");
    await tick(50);
    await pressUntil(tree, "\r", (frame) => frame.includes("API key"));

    await typeIntoField(tree, "sk-local-key", (frame) =>
      frame.includes("*".repeat("sk-local-key".length)),
    );
    expect(tree.lastFrame() ?? "").not.toContain("sk-local-key");
    await pressUntil(tree, "\r", (frame) => frame.includes("Model name"));

    await typeIntoField(tree, "qwen2.5-coder");
    await pressUntilMet(tree, "\r", () => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith({
      protocol: "openai-compatible",
      apiBase: "http://127.0.0.1:8080/v1",
      apiKey: "sk-local-key",
      model: "qwen2.5-coder",
    });
  });

  it("requires an explicit protocol choice", async () => {
    const { tree } = renderScreen();

    await pressUntil(tree, "\r", (frame) =>
      frame.includes("Choose a protocol before continuing"),
    );
  });

  it("keeps the key step open when the key is empty", async () => {
    const { tree, onComplete } = renderScreen();

    await pressUntil(tree, "1", (frame) => frame.includes("❯ 1)"));
    await pressUntil(tree, "\r", (frame) => frame.includes("Base URL"));
    await pressUntil(tree, "\r", (frame) => frame.includes("API key"));
    await pressUntil(tree, "\r", (frame) =>
      frame.includes("API key is required"),
    );

    expect(onComplete).not.toHaveBeenCalled();

    await typeIntoField(tree, "sk-test", (frame) =>
      frame.includes("*".repeat("sk-test".length)),
    );
    await pressUntil(tree, "\r", (frame) => frame.includes("Model name"));
    await pressUntilMet(tree, "\r", () => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test", model: "gpt-4.1" }),
    );
  });

  it("cancels on Escape", async () => {
    const { tree, onCancel, onComplete } = renderScreen();

    await pressUntilMet(tree, "\u001b", () => onCancel.mock.calls.length > 0);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("takes typed text and Enter delivered in one read", async () => {
    const { tree } = renderScreen();

    await pressUntil(tree, "1", (frame) => frame.includes("❯ 1)"));
    await pressUntil(tree, "\r", (frame) => frame.includes("Base URL"));

    tree.stdin.write("http://127.0.0.1:9000/v1\r");
    await waitForFrame(tree, (frame) => frame.includes("API key"));
  });

  it("takes a bare newline as Enter", async () => {
    const { tree } = renderScreen();

    await pressUntil(tree, "2", (frame) => frame.includes("❯ 2)"));
    tree.stdin.write("\n");
    await waitForFrame(tree, (frame) => frame.includes("Base URL"));
  });
});
