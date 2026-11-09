import { describe, expect, it } from "vitest";

import {
  agentSourcesFromModelState,
  agentSuggestionItems,
  commandSuggestionItems,
  fileSuggestionItems,
  filterSuggestionItems,
  MAX_VISIBLE_SUGGESTIONS,
  mcpResourcesFromState,
  mcpSuggestionItems,
  mergeSuggestionGroups,
  SUGGESTION_ICONS,
  suggestionDisplay,
  topLevelPathItems,
  visibleSuggestionWindow,
  windowStart,
} from "./suggestionSources.js";

const COMMANDS = [
  { name: "help", description: "Show help message" },
  { name: "model", description: "Switch the chat model" },
];

const FILES = [
  { path: "README.md" },
  { path: "package.json" },
  { path: "src/ui/UserInput.tsx" },
  { path: "src/ui/FileSearchUI.tsx" },
  { path: "docs/tui.md" },
];

const AGENTS = [
  { name: "verification", description: "Checks finished work" },
  { name: "explore", description: "Maps the codebase" },
];

const MCP_RESOURCES = [
  {
    uri: "docs://readme",
    name: "Project docs",
    description: "Published documentation",
  },
];

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe("command suggestions", () => {
  it("draws commands plainly and completes with their slash path", () => {
    const items = commandSuggestionItems(COMMANDS);

    expect(labels(items)).toEqual(["/help", "/model"]);
    expect(items[0]?.insertText).toBe("/help");
    expect(items.every((item) => item.kind === "command")).toBe(true);
    expect(items.map(suggestionDisplay)).toEqual(["/help", "/model"]);
  });

  it("filters case-insensitively over name and description", () => {
    const items = commandSuggestionItems(COMMANDS);

    expect(labels(filterSuggestionItems(items, "HELP"))).toEqual(["/help"]);
    expect(labels(filterSuggestionItems(items, "chat model"))).toEqual([
      "/model",
    ]);
    expect(filterSuggestionItems(items, "nothing")).toEqual([]);
  });
});

describe("file suggestions", () => {
  it("shows the type icon and the path for a match", () => {
    const items = fileSuggestionItems(FILES, "userinput");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "file",
      label: "src/ui/UserInput.tsx",
      description: "src/ui",
      insertText: "src/ui/UserInput.tsx",
      filePath: "src/ui/UserInput.tsx",
    });
    expect(suggestionDisplay(items[0]!)).toBe("+ src/ui/UserInput.tsx");
  });

  it("shows top-level directories and files for an empty query", () => {
    const items = topLevelPathItems(FILES);

    expect(labels(items)).toEqual([
      "docs/",
      "src/",
      "package.json",
      "README.md",
    ]);
    expect(items[0]?.isDirectory).toBe(true);
    expect(items[0]?.insertText).toBe("docs/");
  });

  it("matches the description column too", () => {
    const items = fileSuggestionItems(FILES, "src/ui");

    expect(labels(items)).toEqual([
      "src/ui/UserInput.tsx",
      "src/ui/FileSearchUI.tsx",
    ]);
  });
});

describe("agent suggestions", () => {
  it("uses the agent mark and the bare name as the insert text", () => {
    const items = agentSuggestionItems(AGENTS);

    expect(labels(items)).toEqual(["verification", "explore"]);
    expect(items.map(suggestionDisplay)).toEqual([
      "* verification",
      "* explore",
    ]);
    expect(items[0]?.insertText).toBe("verification");
  });

  it("lists configured agents and built-in roles that are dispatchable", () => {
    const sources = agentSourcesFromModelState({
      model: { name: "session" },
      assistant: {
        models: [
          {
            name: "reviewer",
            description: "Reviews changes",
            roles: ["subagent"],
            chatOptions: { baseSystemMessage: "review" },
          },
          {
            name: "chat-model",
            roles: ["chat"],
            chatOptions: { baseSystemMessage: "chat" },
          },
        ],
      },
    });

    expect(sources[0]).toEqual({
      name: "reviewer",
      description: "Reviews changes",
    });
    expect(sources.map((source) => source.name)).toContain("verification");
    expect(sources.map((source) => source.name)).not.toContain("chat-model");
  });

  it("leaves out built-ins until a model can run them", () => {
    expect(agentSourcesFromModelState({ assistant: { models: [] } })).toEqual(
      [],
    );
  });
});

describe("MCP resource suggestions", () => {
  it("uses the resource diamond and the uri as the insert text", () => {
    const items = mcpSuggestionItems(MCP_RESOURCES);

    expect(items[0]).toMatchObject({
      kind: "mcp",
      label: "Project docs",
      insertText: "docs://readme",
    });
    expect(suggestionDisplay(items[0]!)).toBe("◇ Project docs");
  });

  it("reads resources from a service state that carries them", () => {
    expect(mcpResourcesFromState({ resources: MCP_RESOURCES })).toEqual(
      MCP_RESOURCES,
    );
    expect(mcpResourcesFromState({ tools: [] })).toEqual([]);
    expect(mcpResourcesFromState(null)).toEqual([]);
  });
});

describe("the unified list", () => {
  it("orders files, then agents, then MCP resources with one icon each", () => {
    const merged = mergeSuggestionGroups(
      fileSuggestionItems(FILES, "ui/"),
      agentSuggestionItems(AGENTS),
      mcpSuggestionItems(MCP_RESOURCES),
    );

    expect(merged.map((item) => item.kind)).toEqual([
      "file",
      "file",
      "agent",
      "agent",
      "mcp",
    ]);
    expect(merged.map(suggestionDisplay)).toEqual([
      "+ src/ui/UserInput.tsx",
      "+ src/ui/FileSearchUI.tsx",
      "* verification",
      "* explore",
      "◇ Project docs",
    ]);
    expect(SUGGESTION_ICONS).toEqual({
      command: "",
      file: "+",
      agent: "*",
      mcp: "◇",
    });
  });
});

describe("the sliding window", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    kind: "command" as const,
    key: `command:c${index}`,
    label: `/c${index}`,
    description: "",
    insertText: `/c${index}`,
  }));

  it("keeps five rows and follows the selection", () => {
    expect(visibleSuggestionWindow(items, 0).map((item) => item.label)).toEqual(
      ["/c0", "/c1", "/c2", "/c3", "/c4"],
    );
    expect(visibleSuggestionWindow(items, 6).map((item) => item.label)).toEqual(
      ["/c2", "/c3", "/c4", "/c5", "/c6"],
    );
    expect(visibleSuggestionWindow(items, 7)).toHaveLength(
      MAX_VISIBLE_SUGGESTIONS,
    );
  });

  it("never scrolls past either end", () => {
    expect(windowStart(8, 0)).toBe(0);
    expect(windowStart(8, 7)).toBe(3);
    expect(windowStart(3, 2)).toBe(0);
  });
});
