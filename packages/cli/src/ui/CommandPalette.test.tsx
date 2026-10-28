import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandPalette, filterPaletteCommands } from "./CommandPalette.js";

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => [
    { name: "theme", description: "pick the UI theme", category: "system" },
    { name: "model", description: "choose the model", category: "system" },
    {
      name: "clear",
      description: "clear the conversation",
      category: "system",
    },
  ]),
}));

const mounted: { unmount: () => void }[] = [];
function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  for (const tree of mounted) tree.unmount();
  mounted.length = 0;
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

describe("the command palette", () => {
  it("lists the commands and filters them as the reader types", async () => {
    const { lastFrame, stdin } = track(
      <CommandPalette
        assistant={{} as never}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await settle();

    expect(lastFrame()).toContain("theme");
    expect(lastFrame()).toContain("model");

    stdin.write("them");
    await settle();
    expect(lastFrame()).toContain("theme");
    expect(lastFrame()).not.toContain("choose the model");
  });

  it("runs the highlighted command as if it had been typed", async () => {
    const onRun = vi.fn();
    const { stdin } = track(
      <CommandPalette
        assistant={{} as never}
        onRun={onRun}
        onCancel={vi.fn()}
      />,
    );
    await settle();

    stdin.write("mo");
    await settle();
    stdin.write("\r");
    await settle();

    expect(onRun).toHaveBeenCalledWith("/model");
  });

  it("moves with the arrow keys and closes on escape", async () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = track(
      <CommandPalette
        assistant={{} as never}
        onRun={onRun}
        onCancel={onCancel}
      />,
    );
    await settle();

    stdin.write("\u001B[B");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onRun).toHaveBeenCalledWith("/model");

    stdin.write("\u001B");
    await settle();
    expect(onCancel).toHaveBeenCalled();
  });

  it("says when nothing matches instead of showing an empty box", async () => {
    const { lastFrame, stdin } = track(
      <CommandPalette
        assistant={{} as never}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await settle();

    stdin.write("zzzz");
    await settle();

    expect(lastFrame()).toContain("No command matches");
  });
});

describe("the palette filter", () => {
  it("matches the name or the description", () => {
    const commands = [
      {
        name: "theme",
        description: "pick the UI theme",
        category: "system" as const,
      },
      {
        name: "model",
        description: "choose the model",
        category: "system" as const,
      },
    ];

    expect(filterPaletteCommands(commands, "them").map((c) => c.name)).toEqual([
      "theme",
    ]);
    expect(filterPaletteCommands(commands, "MODEL").map((c) => c.name)).toEqual(
      ["model"],
    );
    expect(filterPaletteCommands(commands, "  ").length).toBe(2);
  });
});
