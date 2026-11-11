import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { UserInput } from "./UserInput.js";

const { fileIndexState } = vi.hoisted(() => ({
  fileIndexState: {
    files: [
      { path: "README.md", displayName: "README.md" },
      { path: "package.json", displayName: "package.json" },
      { path: "docs/tui.md", displayName: "docs/tui.md" },
      { path: "src/ui/UserInput.tsx", displayName: "src/ui/UserInput.tsx" },
    ],
    isIndexing: false,
    error: null,
  },
}));

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => [
    { name: "help", description: "Show help", category: "system" },
    { name: "model", description: "Switch the chat model", category: "system" },
  ]),
}));

vi.mock("./hooks/useService.js", () => ({
  useService: () => ({
    value: null,
    state: "ready",
    error: null,
    reload: vi.fn(),
  }),
  useServices: () => ({
    services: { fileIndex: fileIndexState },
    loading: false,
    error: null,
    allReady: true,
  }),
}));

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

const renderInput = async (onSubmit = vi.fn()) => {
  const tree = render(
    <KeypressProvider>
      <UserInput
        onSubmit={onSubmit}
        inputMode={true}
        isWaitingForResponse={false}
        assistant={{} as any}
      />
    </KeypressProvider>,
  );
  await tick();
  return { tree, onSubmit };
};

const frameOf = (tree: ReturnType<typeof render>) => tree.lastFrame() ?? "";

describe("UserInput unified suggestions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows one command list for a slash token and accepts with Enter", async () => {
    const { tree, onSubmit } = await renderInput();
    try {
      tree.stdin.write("/mo");
      await tick();

      const frame = frameOf(tree);
      expect(frame).toContain("/model");
      expect(frame).not.toContain("-- /");
      expect(frame).toContain("↑/↓ to navigate");

      tree.stdin.write("\r");
      await tick();
      expect(onSubmit).toHaveBeenCalledWith("/model");
    } finally {
      tree.unmount();
    }
  });

  it("filters commands over their description too", async () => {
    const { tree } = await renderInput();
    try {
      tree.stdin.write("/switch");
      await tick();

      expect(frameOf(tree)).toContain("/model");
    } finally {
      tree.unmount();
    }
  });

  it("inserts an accepted file after @ with one separating space", async () => {
    const { tree } = await renderInput();
    try {
      tree.stdin.write("@README");
      await tick();
      expect(frameOf(tree)).toContain("+ README.md");

      tree.stdin.write("\r");
      await tick();

      const frame = frameOf(tree);
      expect(frame).toContain("@README.md");
      expect(frame).not.toContain("+ README.md");

      // The separating space is not visible at the end of a trimmed line, so
      // type the next word and check the two are apart.
      tree.stdin.write("next");
      await tick();
      expect(frameOf(tree)).toContain("@README.md next");
    } finally {
      tree.unmount();
    }
  });

  it("accepts an @ row with Tab as well", async () => {
    const { tree } = await renderInput();
    try {
      tree.stdin.write("@pack");
      await tick();
      expect(frameOf(tree)).toContain("+ package.json");

      tree.stdin.write("\t");
      await tick();

      expect(frameOf(tree)).toContain("@package.json");
    } finally {
      tree.unmount();
    }
  });

  it("shows top-level paths when nothing follows @", async () => {
    const { tree } = await renderInput();
    try {
      tree.stdin.write("@");
      await tick();

      const frame = frameOf(tree);
      expect(frame).toContain("+ src/");
      expect(frame).toContain("+ package.json");
      expect(frame).not.toContain("+ src/ui/UserInput.tsx");
    } finally {
      tree.unmount();
    }
  });

  it("shows an agent row with the agent mark", async () => {
    vi.spyOn(services.model, "getState").mockReturnValue({
      llmApi: null,
      model: { name: "session" },
      assistant: {
        models: [
          {
            name: "reviewer",
            description: "Reviews changes",
            roles: ["subagent"],
            chatOptions: { baseSystemMessage: "review" },
          },
        ],
      },
    } as any);

    const { tree } = await renderInput();
    try {
      tree.stdin.write("@rev");
      await tick();

      expect(frameOf(tree)).toContain("* reviewer");
    } finally {
      tree.unmount();
    }
  });

  it("shows an MCP resource row with the diamond", async () => {
    vi.spyOn(services.mcp, "getState").mockReturnValue({
      mcpService: null,
      connections: [],
      tools: [],
      prompts: [],
      resources: [
        {
          uri: "docs://readme",
          name: "Project docs",
          description: "Published documentation",
        },
      ],
    } as any);

    const { tree } = await renderInput();
    try {
      tree.stdin.write("@proj");
      await tick();

      expect(frameOf(tree)).toContain("◇ Project docs");
    } finally {
      tree.unmount();
    }
  });

  it("orders a file row before an agent row", async () => {
    vi.spyOn(services.model, "getState").mockReturnValue({
      llmApi: null,
      model: { name: "session" },
      assistant: {
        models: [
          {
            name: "reviewer",
            description: "Reviews changes",
            roles: ["subagent"],
            chatOptions: { baseSystemMessage: "review" },
          },
        ],
      },
    } as any);

    const { tree } = await renderInput();
    try {
      tree.stdin.write("@re");
      await tick();

      const frame = frameOf(tree);
      const fileIndex = frame.indexOf("+ README.md");
      const agentIndex = frame.indexOf("* reviewer");
      expect(fileIndex).toBeGreaterThan(-1);
      expect(agentIndex).toBeGreaterThan(fileIndex);
    } finally {
      tree.unmount();
    }
  });

  it("closes the @ list with Esc and keeps the typed token", async () => {
    const { tree } = await renderInput();
    try {
      tree.stdin.write("@READ");
      await tick();
      expect(frameOf(tree)).toContain("+ README.md");

      tree.stdin.write("\x1b");
      await tick();

      const frame = frameOf(tree);
      expect(frame).not.toContain("+ README.md");
      expect(frame).toContain("@READ");
    } finally {
      tree.unmount();
    }
  });

  it("closes the slash list with Esc", async () => {
    const { tree } = await renderInput();
    try {
      tree.stdin.write("/");
      await tick();
      expect(frameOf(tree)).toContain("/help");

      tree.stdin.write("\x1b");
      await tick();

      expect(frameOf(tree)).not.toContain("/help");
    } finally {
      tree.unmount();
    }
  });

  it("leaves plain typing unchanged", async () => {
    const { tree, onSubmit } = await renderInput();
    try {
      tree.stdin.write("hello world");
      await tick();

      const frame = frameOf(tree);
      expect(frame).toContain("hello world");
      expect(frame).not.toContain("↑/↓ to navigate");

      tree.stdin.write("\r");
      await tick();
      expect(onSubmit.mock.calls[0]?.[0]).toBe("hello world");
    } finally {
      tree.unmount();
    }
  });
});
