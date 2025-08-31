import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "../i18n/index.js";

import { MCPSelector } from "./MCPSelector.js";

// The selector reads its state through the service hook; the mock lets each
// test pick the connection list it needs.
const mockUseServices = vi.fn();
vi.mock("./hooks/useService.js", () => ({
  useServices: () => mockUseServices(),
}));

function emptyService() {
  mockUseServices.mockReturnValue({
    services: { mcp: { connections: [], tools: [], prompts: [] } },
  });
}

// Strip the ANSI coloring and the box border so each line is compared as
// content: the empty-state copy below the title also mentions MCP servers,
// so a plain substring check would pass without the title being translated.
function contentLines(frame: string | undefined): string[] {
  return (frame ?? "")
    .split("\n")
    .map((line) =>
      line.replace(/\u001b\[[0-9;]*m/g, "").replace(/^[\s│]+|[\s│]+$/g, ""),
    );
}

describe("MCPSelector locale", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("renders its header and menu in the active locale", () => {
    emptyService();
    setLocale("zh-CN");

    const { lastFrame } = render(<MCPSelector onCancel={() => {}} />);

    const lines = contentLines(lastFrame());
    expect(lines).toContain("MCP 服务器");
    expect(lines).toContain("返回");
  });

  it("renders the server detail in the active locale", async () => {
    mockUseServices.mockReturnValue({
      services: {
        mcp: {
          connections: [
            {
              config: { name: "alpha", command: "node", args: ["server.js"] },
              status: "connected",
              tools: [{ name: "read" }, { name: "write" }],
              prompts: [{ name: "summarize" }],
              warnings: ["slow start"],
            },
          ],
          tools: [],
          prompts: [],
        },
      },
    });
    setLocale("zh-CN");

    const { lastFrame, stdin, unmount } = render(
      <MCPSelector onCancel={() => {}} />,
    );
    // Enter selects the first menu entry, which is the server itself and only
    // moves local state; no MCP service call happens on this path.
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lines = contentLines(lastFrame());
    expect(lines).toContain("服务器：alpha");
    expect(lines).toContain("工具：2");
    expect(lines).toContain("提示词：1");
    expect(lines.some((line) => line.startsWith("状态："))).toBe(true);
    unmount();
  });
});
