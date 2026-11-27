import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadMarkdownAgents,
  serializeAgentMarkdown,
} from "./markdownAgents.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("markdown agent worktree isolation", () => {
  it("round-trips the isolation frontmatter field", () => {
    const markdown = serializeAgentMarkdown({
      name: "isolated-reviewer",
      description: "Review without touching the checkout",
      systemPrompt: "Review the implementation.",
      isolation: "worktree",
    });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-agent-"));
    roots.push(workspace);
    const directory = path.join(workspace, ".tnt", "agents");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "isolated-reviewer.md"), markdown);

    expect(loadMarkdownAgents(workspace)).toEqual([
      expect.objectContaining({
        name: "isolated-reviewer",
        isolation: "worktree",
        scope: "workspace",
      }),
    ]);
  });
});
