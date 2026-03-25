import * as fs from "fs";
import * as path from "path";

import { TntError, TntErrorReason } from "core/util/errors.js";

import { isWithinWorkspace } from "../permissions/workspacePath.js";

import { connectBrowser, type BrowserClient } from "./browserClient.js";
import { Tool } from "./types.js";

const MAX_TEXT_CHARS = 8_000;
const MAX_LINKS = 25;

export type BrowserAction =
  "navigate" | "snapshot" | "click" | "type" | "screenshot";

export interface BrowserActionArgs {
  action: BrowserAction;
  url?: string;
  selector?: string;
  text?: string;
  submit?: boolean;
  filepath?: string;
}

interface PageState {
  title?: string;
  url?: string;
  text?: string;
  links?: Array<{ text?: string; href?: string }>;
}

const SNAPSHOT_SCRIPT = `(() => ({
  title: document.title,
  url: location.href,
  text: (document.body?.innerText ?? "").slice(0, ${MAX_TEXT_CHARS}),
  links: [...document.querySelectorAll("a[href]")].slice(0, ${MAX_LINKS * 2}).map((a) => ({
    text: (a.innerText ?? "").trim().slice(0, 120),
    href: a.href,
  })),
}))()`;

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Browser ${field} is required for this action.`,
    );
  }
  return value;
}

async function evaluate<T>(
  client: BrowserClient,
  expression: string,
): Promise<T> {
  const response = (await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: T } };
  return response.result?.value as T;
}

function formatSnapshot(state: PageState | undefined): string {
  if (!state) {
    return "The page returned no snapshot.";
  }
  const text = (state.text ?? "").trim();
  const links = (state.links ?? [])
    .filter((link) => link.href)
    .slice(0, MAX_LINKS)
    .map(
      (link, index) => `${index + 1}. ${link.text || "(no text)"} ${link.href}`,
    );
  return [
    `Page: ${state.title || "(no title)"}`,
    `URL: ${state.url ?? "unknown"}`,
    "",
    text || "(the page has no visible text)",
    ...(links.length > 0 ? ["", "Links:", ...links] : []),
  ].join("\n");
}

async function pressEnter(client: BrowserClient): Promise<void> {
  const key = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

async function saveScreenshot(
  client: BrowserClient,
  filepath: string,
): Promise<string> {
  const absolute = path.resolve(filepath);
  if (!isWithinWorkspace(absolute)) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Screenshots must be written inside the workspace: ${filepath}`,
    );
  }
  if (!absolute.toLowerCase().endsWith(".png")) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "A screenshot filepath must end in .png.",
    );
  }
  const result = (await client.send("Page.captureScreenshot", {
    format: "png",
  })) as { data?: string };
  if (!result.data) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "The browser returned no screenshot data.",
    );
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, Buffer.from(result.data, "base64"));
  return `Saved a screenshot to ${path.relative(process.cwd(), absolute)}.`;
}

/** The action layer, kept separate so a test can drive it with a fake client. */
export async function executeBrowserAction(
  client: BrowserClient,
  args: BrowserActionArgs,
): Promise<string> {
  switch (args.action) {
    case "navigate": {
      const target = requireText(args.url, "url");
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        throw new TntError(TntErrorReason.Unspecified, `Not a URL: ${target}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new TntError(
          TntErrorReason.Unspecified,
          "The browser tool navigates to http or https URLs only.",
        );
      }
      await client.send("Page.navigate", { url: parsed.toString() });
      const state = await evaluate<PageState>(client, SNAPSHOT_SCRIPT);
      return `Navigated to ${state?.url ?? parsed.toString()} (${state?.title || "no title"}).`;
    }
    case "snapshot": {
      return formatSnapshot(await evaluate<PageState>(client, SNAPSHOT_SCRIPT));
    }
    case "click": {
      const selector = requireText(args.selector, "selector");
      const result = await evaluate<{ found?: boolean; text?: string }>(
        client,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { found: false };
          el.scrollIntoView({ block: "center" });
          el.click();
          return { found: true, text: (el.innerText ?? "").trim().slice(0, 120) };
        })()`,
      );
      if (!result?.found) {
        throw new TntError(
          TntErrorReason.Unspecified,
          `No element matches ${selector}.`,
        );
      }
      return `Clicked ${selector}${result.text ? ` (${result.text})` : ""}.`;
    }
    case "type": {
      const text = typeof args.text === "string" ? args.text : null;
      if (text === null) {
        throw new TntError(
          TntErrorReason.Unspecified,
          "Browser text is required for a type action.",
        );
      }
      if (args.selector) {
        const focused = await evaluate<boolean>(
          client,
          `(() => {
            const el = document.querySelector(${JSON.stringify(args.selector)});
            if (!el) return false;
            el.focus();
            if (typeof el.select === "function") el.select();
            return true;
          })()`,
        );
        if (!focused) {
          throw new TntError(
            TntErrorReason.Unspecified,
            `No element matches ${args.selector}.`,
          );
        }
      }
      await client.send("Input.insertText", { text });
      if (args.submit) {
        await pressEnter(client);
      }
      return `Typed ${text.length} character(s)${
        args.selector ? ` into ${args.selector}` : ""
      }${args.submit ? " and pressed Enter" : ""}.`;
    }
    case "screenshot": {
      return saveScreenshot(client, requireText(args.filepath, "filepath"));
    }
    default: {
      throw new TntError(
        TntErrorReason.Unspecified,
        `Unknown browser action: ${String(args.action)}.`,
      );
    }
  }
}

export const browserTool: Tool = {
  name: "Browser",
  displayName: "Browser",
  description: `Drive a browser the user started with a remote debugging port (default http://127.0.0.1:9222, override with TNT_BROWSER_ENDPOINT). Actions: navigate (http/https), snapshot (title, URL, visible text and links), click (CSS selector), type (text, optional selector and submit), screenshot (write a .png inside the workspace).
The browser must already be running and visible; this tool does not launch a hidden one. It reads the page the user has open, so a click or a typed message is a real action on that page.`,
  parameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        description: "navigate, snapshot, click, type or screenshot",
      },
      url: { type: "string", description: "The URL to open" },
      selector: {
        type: "string",
        description: "CSS selector for click or type",
      },
      text: { type: "string", description: "Text to type" },
      submit: {
        type: "boolean",
        description: "Press Enter after typing",
      },
      filepath: {
        type: "string",
        description: "A .png path inside the workspace for screenshot",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => ({
    args,
    preview: [
      {
        type: "text",
        content: `Will ${String(args?.action ?? "use")} the browser${
          args?.url ? `: ${String(args.url)}` : ""
        }`,
      },
    ],
  }),
  run: async (args: BrowserActionArgs): Promise<string> => {
    const client = await connectBrowser();
    try {
      return await executeBrowserAction(client, args);
    } finally {
      client.close();
    }
  },
};
