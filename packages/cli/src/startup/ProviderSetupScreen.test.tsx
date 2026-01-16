import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSetupScreen } from "./ProviderSetupScreen.js";

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

const mounted: { unmount: () => void }[] = [];

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

describe("ProviderSetupScreen", () => {
  it("collects protocol, base URL, key and model in one box", async () => {
    const { tree, onComplete } = renderScreen();

    tree.stdin.write("5");
    await tick();
    tree.stdin.write("\r");
    await tick();
    expect(tree.lastFrame() ?? "").toContain("Base URL");
    expect(tree.lastFrame() ?? "").toContain("http://localhost:11434/v1/");

    tree.stdin.write("http://127.0.0.1:8080/v1");
    await tick();
    expect(tree.lastFrame() ?? "").not.toContain("http://localhost:11434/v1/");
    tree.stdin.write("\r");
    await tick();
    expect(tree.lastFrame() ?? "").toContain("API key");

    tree.stdin.write("sk-local-key");
    await tick();
    expect(tree.lastFrame() ?? "").not.toContain("sk-local-key");
    tree.stdin.write("\r");
    await tick();

    tree.stdin.write("qwen2.5-coder");
    await tick();
    tree.stdin.write("\r");
    await tick();

    expect(onComplete).toHaveBeenCalledWith({
      protocol: "openai-compatible",
      apiBase: "http://127.0.0.1:8080/v1",
      apiKey: "sk-local-key",
      model: "qwen2.5-coder",
    });
  });

  it("requires an explicit protocol choice", async () => {
    const { tree } = renderScreen();

    tree.stdin.write("\r");
    await tick();

    expect(tree.lastFrame() ?? "").toContain(
      "Choose a protocol before continuing",
    );
  });

  it("keeps the key step open when the key is empty", async () => {
    const { tree, onComplete } = renderScreen();

    tree.stdin.write("1");
    await tick();
    tree.stdin.write("\r");
    await tick();
    tree.stdin.write("\r");
    await tick();
    tree.stdin.write("\r");
    await tick();

    expect(tree.lastFrame() ?? "").toContain("API key is required");
    expect(onComplete).not.toHaveBeenCalled();

    tree.stdin.write("sk-test");
    await tick();
    tree.stdin.write("\r");
    await tick();
    tree.stdin.write("\r");
    await tick();

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test", model: "gpt-4.1" }),
    );
  });

  it("cancels on Escape", async () => {
    const { tree, onCancel, onComplete } = renderScreen();

    tree.stdin.write("\u001b");
    await tick();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
