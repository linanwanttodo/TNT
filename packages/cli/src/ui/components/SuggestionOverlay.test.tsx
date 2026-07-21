import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  commandSuggestionItems,
  type SuggestionItem,
} from "../suggestionSources.js";

import { SuggestionOverlay } from "./SuggestionOverlay.js";

const commands = commandSuggestionItems(
  Array.from({ length: 8 }, (_, index) => ({
    name: `command-${index}`,
    description: `description ${index}`,
  })),
);

const renderOverlay = (items: readonly SuggestionItem[], selectedIndex = 0) => {
  const tree = render(
    <SuggestionOverlay
      show={true}
      items={items}
      selectedIndex={selectedIndex}
      emptyText="No matches"
    />,
  );
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
};

describe("SuggestionOverlay", () => {
  it("draws five rows and slides the window with the selection", () => {
    const first = renderOverlay(commands);
    expect(first).toContain("/command-0");
    expect(first).toContain("/command-4");
    expect(first).not.toContain("/command-5");

    const last = renderOverlay(commands, 7);
    expect(last).not.toContain("/command-2");
    expect(last).toContain("/command-3");
    expect(last).toContain("/command-7");
    expect(last).toContain("(8/8)");
  });

  it("draws the type icons and leaves commands bare", () => {
    const items: SuggestionItem[] = [
      {
        kind: "file",
        key: "file:src/a.ts",
        label: "src/a.ts",
        description: "src",
        insertText: "src/a.ts",
      },
      {
        kind: "agent",
        key: "agent:explore",
        label: "explore",
        description: "Maps the codebase",
        insertText: "explore",
      },
      {
        kind: "mcp",
        key: "mcp:docs://readme",
        label: "Project docs",
        description: "docs://readme",
        insertText: "docs://readme",
      },
      {
        kind: "command",
        key: "command:help",
        label: "/help",
        description: "Show help",
        insertText: "/help",
      },
    ];

    const frame = renderOverlay(items);
    expect(frame).toContain("+ src/a.ts");
    expect(frame).toContain("* explore");
    expect(frame).toContain("◇ Project docs");
    expect(frame).toContain("/help");
  });

  it("shows the empty text and still draws the position counter", () => {
    const frame = renderOverlay([], 0);
    expect(frame).toContain("No matches");
    expect(frame).toMatch(/\(\d+\/\d+\)/);
  });

  it("draws a level label for a parent command's children", () => {
    const tree = render(
      <SuggestionOverlay
        show={true}
        items={commands.slice(0, 2)}
        selectedIndex={0}
        emptyText="No matches"
        levelLabel="/language"
      />,
    );
    const frame = tree.lastFrame() ?? "";
    tree.unmount();
    expect(frame).toContain("-- /language --");
  });
});
