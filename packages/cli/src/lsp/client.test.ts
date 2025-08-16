import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LspClient, languageIdForPath } from "./client.js";

const SERVER = path.join(process.cwd(), "test-fixtures", "fake-lsp-server.mjs");
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-lsp-"));

const started: LspClient[] = [];

function serverConfig(extraArgs: string[] = []) {
  return { command: process.execPath, args: [SERVER, ...extraArgs] };
}

async function startClient(
  options: Parameters<typeof LspClient.start>[1] = { rootPath: fixtureDir },
  extraArgs: string[] = [],
): Promise<LspClient> {
  const client = await LspClient.start(serverConfig(extraArgs), options);
  started.push(client);
  return client;
}

afterEach(async () => {
  for (const client of started.splice(0)) {
    await client.dispose().catch(() => {});
  }
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.mkdirSync(fixtureDir, { recursive: true });
});

describe("language id mapping", () => {
  it("maps the extensions the CLI works with", () => {
    expect(languageIdForPath("a/b/c.ts")).toBe("typescript");
    expect(languageIdForPath("c.tsx")).toBe("typescriptreact");
    expect(languageIdForPath("c.JSON")).toBe("json");
    expect(languageIdForPath("notes.md")).toBe("markdown");
    expect(languageIdForPath("weird.zzz")).toBe("plaintext");
  });
});

describe("lsp client lifecycle", () => {
  it("completes the initialize handshake", async () => {
    const client = await startClient();

    expect(client).toBeInstanceOf(LspClient);
  });

  it("refuses when the command cannot be spawned", async () => {
    const onServerError = vi.fn();

    await expect(
      LspClient.start(
        { command: "definitely-not-a-real-lsp-binary" },
        { rootPath: fixtureDir, timeoutMs: 500, onServerError },
      ),
    ).rejects.toThrow(/definitely-not-a-real-lsp-binary/);
    expect(onServerError).toHaveBeenCalled();
  });

  it("refuses when the server dies during the handshake", async () => {
    await expect(
      LspClient.start(serverConfig(["--die-on-start"]), {
        rootPath: fixtureDir,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/exited|did not answer/);
  });

  it("stops the child process on dispose", async () => {
    const client = await startClient();

    await client.dispose();

    await expect(client.request("textDocument/hover", {})).rejects.toThrow(
      /closed/,
    );
  });

  it("reports a server error to the listener", async () => {
    const onServerError = vi.fn();
    const client = await startClient({
      rootPath: fixtureDir,
      onServerError,
    });

    // Killing the server from under the client is the case a coding agent will
    // actually hit when a language server crashes.
    (client as unknown as { child: { kill: () => void } }).child.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(onServerError).toHaveBeenCalled();
  });
});

describe("documents and diagnostics", () => {
  it("collects the diagnostics published for an opened document", async () => {
    const diagnostics: { uri: string; messages: string[] }[] = [];
    const client = await startClient({
      rootPath: fixtureDir,
      onDiagnostics: (uri, published) => {
        diagnostics.push({ uri, messages: published.map((d) => d.message) });
      },
    });

    const content = "const BAD = 1\n";
    const file = path.join(fixtureDir, "sample.ts");
    fs.writeFileSync(file, content);
    client.openDocument(file, content);

    await vi.waitFor(() => expect(diagnostics).toHaveLength(1));
    expect(diagnostics[0].uri).toContain("sample.ts");
    expect(diagnostics[0].messages[0]).toContain("fake diagnostic");
  });

  it("returns the result of a request it can answer", async () => {
    const client = await startClient();

    const result = await client.request("textDocument/hover", {
      position: { line: 4, character: 2 },
    });

    expect(result).toEqual({ contents: "hover at 4:2" });
  });

  it("rejects with the server error message for an unknown method", async () => {
    const client = await startClient();

    await expect(client.request("workspace/nope", {})).rejects.toThrow(
      /Unknown method workspace\/nope/,
    );
  });

  it("rejects rather than hanging when the server never answers", async () => {
    const client = await startClient({ rootPath: fixtureDir, timeoutMs: 300 });

    await expect(client.request("test/slow", {})).rejects.toThrow(
      /did not answer test\/slow/,
    );
  });
});
