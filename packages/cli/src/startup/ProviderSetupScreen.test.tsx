import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pressUntil,
  pressUntilMet,
  until,
} from "../../test-utils/renderPress.js";
import { setLocale } from "../i18n/index.js";

import { ProviderSetupScreen } from "./ProviderSetupScreen.js";

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

/** The frame a step transition must have produced, so a lost keystroke is
 * re-sent instead of being mistaken for a broken screen. Only Enter and the
 * protocol digits are re-sent: they set a state absolutely. Typed text is
 * appended, so waiting for it never re-delivers. */
const frameHas =
  (tree: { lastFrame: () => string | undefined }) => (text: string) =>
    (tree.lastFrame() ?? "").includes(text);

describe("ProviderSetupScreen", () => {
  it("collects protocol, base URL, key and model in one box", async () => {
    const { tree, onComplete } = renderScreen();

    await pressUntil(tree, "5", (frame) => frame.includes("❯ 5)"));
    await pressUntil(tree, "\r", (frame) => frame.includes("Base URL"));
    expect(tree.lastFrame() ?? "").toContain("http://localhost:11434/v1/");

    tree.stdin.write("http://127.0.0.1:8080/v1");
    await until(() => frameHas(tree)("http://127.0.0.1:8080/v1"));
    expect(tree.lastFrame() ?? "").not.toContain("http://localhost:11434/v1/");
    await pressUntil(tree, "\r", (frame) => frame.includes("API key"));

    tree.stdin.write("sk-local-key");
    await until(() => frameHas(tree)("*".repeat("sk-local-key".length)));
    expect(tree.lastFrame() ?? "").not.toContain("sk-local-key");
    await pressUntil(tree, "\r", (frame) => frame.includes("Model name"));

    tree.stdin.write("qwen2.5-coder");
    await until(() => frameHas(tree)("qwen2.5-coder"));
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

    tree.stdin.write("sk-test");
    await until(() => frameHas(tree)("*".repeat("sk-test".length)));
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
});
