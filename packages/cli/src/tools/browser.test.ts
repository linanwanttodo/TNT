import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeBrowserAction } from "./browser.js";

interface Call {
  method: string;
  params?: Record<string, unknown>;
}

function fakeClient(options: {
  evaluations?: unknown[];
  screenshot?: string;
}): {
  calls: Call[];
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
} {
  const calls: Call[] = [];
  const evaluations = [...(options.evaluations ?? [])];
  return {
    calls,
    async send(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        return { result: { value: evaluations.shift() } };
      }
      if (method === "Page.captureScreenshot") {
        return { data: options.screenshot };
      }
      return {};
    },
  };
}

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(process.cwd(), ".tnt-browser-"));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("executeBrowserAction", () => {
  it("navigates to an http URL and reports where it landed", async () => {
    const client = fakeClient({
      evaluations: [{ title: "Example", url: "https://example.com/" }],
    });

    const result = await executeBrowserAction(client, {
      action: "navigate",
      url: "https://example.com",
    });

    expect(result).toContain("https://example.com/");
    expect(result).toContain("Example");
    expect(client.calls[0]).toEqual({
      method: "Page.navigate",
      params: { url: "https://example.com/" },
    });
  });

  it("refuses a non-http URL", async () => {
    const client = fakeClient({});

    await expect(
      executeBrowserAction(client, {
        action: "navigate",
        url: "file:///etc/passwd",
      }),
    ).rejects.toThrow(/http or https/);
  });

  it("formats the visible text and links of a snapshot", async () => {
    const client = fakeClient({
      evaluations: [
        {
          title: "Docs",
          url: "https://example.com/docs",
          text: "Hello world",
          links: [{ text: "More", href: "https://example.com/more" }],
        },
      ],
    });

    const result = await executeBrowserAction(client, { action: "snapshot" });

    expect(result).toContain("Page: Docs");
    expect(result).toContain("Hello world");
    expect(result).toContain("More https://example.com/more");
  });

  it("clicks a matching element and refuses a missing one", async () => {
    const found = fakeClient({
      evaluations: [{ found: true, text: "Submit" }],
    });
    await expect(
      executeBrowserAction(found, { action: "click", selector: "#go" }),
    ).resolves.toContain("Clicked #go (Submit)");

    const missing = fakeClient({ evaluations: [{ found: false }] });
    await expect(
      executeBrowserAction(missing, { action: "click", selector: "#gone" }),
    ).rejects.toThrow(/No element matches/);
  });

  it("types into the focused element and submits with Enter", async () => {
    const client = fakeClient({ evaluations: [true] });

    const result = await executeBrowserAction(client, {
      action: "type",
      selector: "input",
      text: "hello",
      submit: true,
    });

    expect(result).toContain("Typed 5 character(s)");
    expect(client.calls.map((call) => call.method)).toEqual([
      "Runtime.evaluate",
      "Input.insertText",
      "Input.dispatchKeyEvent",
      "Input.dispatchKeyEvent",
    ]);
    expect(client.calls[1].params).toEqual({ text: "hello" });
  });

  it("saves a screenshot inside the workspace and refuses an outside path", async () => {
    const client = fakeClient({
      screenshot: Buffer.from("png-bytes").toString("base64"),
    });
    const target = path.join(workspace, "shot.png");

    const result = await executeBrowserAction(client, {
      action: "screenshot",
      filepath: target,
    });

    expect(result).toContain("Saved a screenshot");
    expect(fs.readFileSync(target, "utf-8")).toBe("png-bytes");

    await expect(
      executeBrowserAction(client, {
        action: "screenshot",
        filepath: "/tmp/outside.png",
      }),
    ).rejects.toThrow(/inside the workspace/);
  });

  it("refuses an unknown action", async () => {
    await expect(
      executeBrowserAction(fakeClient({}), {
        action: "dance" as never,
      }),
    ).rejects.toThrow(/Unknown browser action/);
  });
});
