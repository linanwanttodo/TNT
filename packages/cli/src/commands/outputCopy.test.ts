import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, t } from "../i18n/index.js";

import { formatChecksSummary } from "./checks.js";
import { renderServerStartupHelp } from "./serve.help.js";

let previousLocale: string;

beforeEach(() => {
  previousLocale = getLocale();
  setLocale("en");
});

afterEach(() => {
  setLocale(previousLocale as never);
});

describe("the serve startup banner", () => {
  it("names the address, the endpoints and the idle timeout", () => {
    const lines = renderServerStartupHelp(8080, 300);
    const text = lines.join("\n");

    expect(text).toContain("http://localhost:8080");
    expect(text).toContain("Endpoints:");
    expect(text).toContain("GET  /state");
    expect(text).toContain("POST /permission");
    expect(text).toContain("300 seconds of inactivity");
  });

  it("keeps every endpoint in the translated list", () => {
    const english = renderServerStartupHelp(1, 1).join("\n");
    setLocale("zh-CN");
    const chinese = renderServerStartupHelp(1, 1).join("\n");

    for (const route of [
      "/state",
      "/message",
      "/permission",
      "/pause",
      "/diff",
      "/exit",
    ]) {
      expect(english, route).toContain(route);
      expect(chinese, route).toContain(route);
    }
    expect(chinese).toContain("闲置 1 秒后");
    expect(chinese).not.toBe(english);
  });
});

describe("the checks summary line", () => {
  it("lists only the counts that happened", () => {
    expect(
      formatChecksSummary({ successes: 3, failures: 0, pending: 0 }),
    ).toContain("3 passed");
    const mixed = formatChecksSummary({
      successes: 1,
      failures: 2,
      pending: 4,
    });
    expect(mixed).toContain("1 passed");
    expect(mixed).toContain("2 failing");
    expect(mixed).toContain("4 pending");
  });

  it("is empty when a run has no checks", () => {
    expect(formatChecksSummary({ successes: 0, failures: 0, pending: 0 })).toBe(
      "",
    );
  });

  it("follows the selected locale", () => {
    setLocale("zh-CN");
    const text = formatChecksSummary({ successes: 2, failures: 1, pending: 0 });

    expect(text).toContain("2 通过");
    expect(text).toContain("1 失败");
  });
});

/**
 * An argv subcommand is the one surface where a Chinese user meets the CLI
 * without a terminal UI to lean on, and its failure paths are where the copy
 * was left in English. This scans the sources rather than the rendered output,
 * because a raw literal never reaches a `t()` call to be translated by anyone.
 */
function commandSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...commandSources(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
      found.push(full);
    }
  }
  return found;
}

describe("the copy an argv subcommand prints", () => {
  const here = path.join(path.dirname(fileURLToPath(import.meta.url)));

  it("sends every console message through the translation table", () => {
    const offenders: string[] = [];

    for (const file of commandSources(here)) {
      const source = fs.readFileSync(file, "utf-8");
      // The message is the first argument, which may sit on the next line and
      // may be wrapped in a colour call. Only its literal part matters: an
      // interpolation is a value, and values are not copy.
      const calls = source.matchAll(
        /console\.(?:log|error|warn)\(\s*(?:chalk\.\w+\(\s*)?(["'`])([\s\S]{0,200}?)\1/g,
      );

      for (const call of calls) {
        const literal = (call[2] ?? "").replace(/\$\{[\s\S]*?\}/g, "");
        if (/[A-Za-z]{4,}/.test(literal)) {
          const line = source
            .slice(0, call.index ?? 0)
            .split("\n")
            .length.toString();
          offenders.push(`${path.relative(here, file)}:${line} ${literal}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("renders the two failure lines it just took out of the sources", () => {
    setLocale("zh-CN");

    expect(t("review.failed", { message: "no merge base" })).toContain(
      "错误：no merge base",
    );
    // The command name and the flag stay as they are: they are tokens, not copy.
    expect(t("review.workerNeedsFork")).toContain("tnt review");
    expect(t("review.workerNeedsFork")).toContain("子进程");
  });
});
