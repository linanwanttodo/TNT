import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatChecksSummary } from "./checks.js";
import { renderServerStartupHelp } from "./serve.help.js";
import { getLocale, setLocale } from "../i18n/index.js";

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
