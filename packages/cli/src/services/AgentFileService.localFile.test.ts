import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, describe, expect, it } from "vitest";

import { AgentFileService } from "./AgentFileService.js";

/**
 * These cases read real markdown out of a real temporary directory. The other
 * suite for this service replaces the module that fetched packages from the hub,
 * which is the code path that no longer exists - so only an unmocked run can show
 * that naming a model in an agent file is now something the CLI can do.
 */
describe("agent files read from disk", () => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tnt-agent-file-")),
  );
  function writeAgent(name: string, frontmatter: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `---\n${frontmatter}\n---\nReview the diff.\n`);
    return file;
  }

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the model an agent file names, without fetching a package", async () => {
    const file = writeAgent(
      "review.md",
      "name: review\nmodel: claude-sonnet-4-5",
    );

    const state = await new AgentFileService().initialize(file);

    // The assistant configuration defines the model; ModelService matches this name
    // against the models it loaded, so nothing here reaches the network.
    expect(state.agentFileModel).toEqual({ name: "claude-sonnet-4-5" });
  });

  it("parses the rules and tools written in the same frontmatter", async () => {
    const file = writeAgent(
      "with-tools.md",
      "name: reviewer\nrules: Be terse\ntools: Read, Grep",
    );

    const state = await new AgentFileService().initialize(file);

    expect(state.agentFile?.name).toBe("reviewer");
    expect(state.parsedRules).toEqual(["Be terse"]);
    expect(state.parsedTools).not.toBeNull();
  });

  it("refuses an org/agent slug instead of pretending to download it", async () => {
    await expect(
      new AgentFileService().initialize("myorg/review-bot"),
    ).rejects.toThrow(/hub/i);
  });

  it("names the file it could not read", async () => {
    const missing = path.join(dir, "not-committed.md");

    await expect(new AgentFileService().initialize(missing)).rejects.toThrow(
      /not-committed\.md/,
    );
  });
});
