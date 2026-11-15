import { describe, expect, it } from "vitest";

import FileContextProvider from "./FileContextProvider.js";
import OpenFilesContextProvider from "./OpenFilesContextProvider.js";
import ProblemsContextProvider from "./ProblemsContextProvider.js";

/**
 * The same credential-shaped path, refused the same way by every provider that reads files.
 *
 * This suite exists because the check used to be one `if` per provider: `8d53bb333` deleted
 * two of them, left the imports unread, and core's two test lanes stayed green while `@file`
 * and `@problems` returned `.env` contents to the model. `@openfile` kept refusing, which is
 * what proves the deletion was a regression and not a decision.
 */
const SECRET = "API_KEY=do-not-lease-this-to-a-model";
const secretUri = "file:///workspace/project/.env";

const ide = {
  readFile: async (uri: string) => {
    if (uri === secretUri) {
      return SECRET;
    }
    return "export const a = 1;";
  },
  getWorkspaceDirs: async () => ["file:///workspace/project"],
  getOpenFiles: async () => [secretUri],
  getPinnedFiles: async () => [],
  getProblems: async () => [
    {
      filepath: secretUri,
      message: "missing semicolon",
      range: {
        start: { line: 1, character: 0 },
        end: { line: 2, character: 0 },
      },
    },
  ],
};

const extras: any = {
  ide,
  fullMessage: "",
  query: secretUri,
  prompt: "hi",
  vscode: undefined,
  completions: undefined as any,
};

function expectRedacted(items: any[], provider: string) {
  expect(items.length).toBeGreaterThan(0);
  const content = items.map((item) => item.content).join("\n");
  expect(content).toContain("cannot be viewed for security reasons");
  expect(content).not.toContain(SECRET);
  // The item still names the file, so the user sees what was refused.
  expect(items[0].uri?.value ?? items[0].description).toEqual(
    expect.stringContaining(".env"),
  );
  void provider;
}

describe("every file-reading provider refuses credential files", () => {
  it("covers @file", async () => {
    const provider = new FileContextProvider({});
    expectRedacted(await provider.getContextItems(secretUri, extras), "file");
  });

  it("covers @problems", async () => {
    const provider = new ProblemsContextProvider({});
    expectRedacted(await provider.getContextItems("", extras), "problems");
  });

  it("covers @openfile", async () => {
    const provider = new OpenFilesContextProvider({});
    expectRedacted(await provider.getContextItems("", extras), "open");
  });

  it("reads an ordinary file, so the refusal is not a blanket block", async () => {
    const provider = new FileContextProvider({});
    const items = await provider.getContextItems(
      "file:///workspace/project/src/main.ts",
      extras,
    );
    expect(items[0].content).toContain("export const a = 1;");
  });
});
