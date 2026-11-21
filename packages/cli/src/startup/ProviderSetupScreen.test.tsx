import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pressUntil,
  pressUntilMet,
  typeIntoField,
} from "../../test-utils/renderPress.js";
import { setLocale } from "../i18n/index.js";
import { KeypressProvider } from "../ui/contexts/KeypressContext.js";

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
  // The screen reads keys through the app's parser, so the provider that
  // owns the parser has to be mounted, as it is in both real entry points.
  const tree = render(
    <KeypressProvider>
      <ProviderSetupScreen onComplete={onComplete} onCancel={onCancel} />
    </KeypressProvider>,
  );
  mounted.push(tree);
  return { tree, onComplete, onCancel };
}

/** One write, one wait: the screen moves on its own after the chunk. */
async function waitForFrame(
  tree: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
  // The screen renders on a timer, so the wait is a poll rather than a
  // promise. Under a loaded runner (the coverage floor runs the whole suite
  // in parallel) five seconds was not always enough for the next frame, and
  // the failure looked like a broken screen rather than a slow one.
  timeoutMs = 20_000,
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

  // The hint under the list tells the reader to pick with the arrows. The
  // screen used to keep the arrow choice only in React state, while Enter read
  // the synchronous ref the digit keys write, so the instructed path always
  // answered "Choose a protocol before continuing."
  it("selects a protocol with the arrow keys", async () => {
    const { tree } = renderScreen();

    await pressUntil(tree, "\u001b[B", (frame) => frame.includes("❯ 1)"));
    await pressUntil(tree, "\r", (frame) => frame.includes("Base URL"));
    expect(tree.lastFrame() ?? "").not.toContain(
      "Choose a protocol before continuing",
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

  // The report that started this fix: at the API-key step Escape did nothing,
  // because the screen read keys with a parser that could not see Escape once
  // the terminal had negotiated a richer keyboard protocol. Escape has to
  // cancel from every step, including the middle of a field.
  it("cancels on Escape from the API-key step", async () => {
    const { tree, onCancel, onComplete } = renderScreen();

    await pressUntil(tree, "1", (frame) => frame.includes("❯ 1)"));
    await pressUntil(tree, "\r", (frame) => frame.includes("Base URL"));
    await pressUntil(tree, "\r", (frame) => frame.includes("API key"));

    tree.stdin.write("\u001b");
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
    // A single stdin write can be swallowed on a loaded Windows runner. Re-send
    // the bare newline through the same delivery loop the other cases use: the
    // assertion stays "a lone \n acts as Enter", not "a burst of keys does".
    await pressUntil(tree, "\n", (frame) => frame.includes("Base URL"), {
      attempts: 5,
    });
  });
});
