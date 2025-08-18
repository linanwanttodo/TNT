import fs from "fs";

import { describe, expect, test, vi } from "vitest";

import {
  getLocale,
  LOCALES,
  LOCALE_LABELS,
  setLocale,
  subscribeLocale,
  t,
} from "./index.js";

describe("i18n runtime locale switching", () => {
  const originalLocale = getLocale();

  test("has both English and Simplified Chinese dictionaries", () => {
    expect(LOCALES).toEqual(["en", "zh-CN"]);
    expect(LOCALE_LABELS.en).toBe("English");
    expect(LOCALE_LABELS["zh-CN"]).toBe("简体中文");
  });

  test("falls back to English for an untranslated key in another locale", () => {
    setLocale("zh-CN");
    expect(t("setup.baseUrl")).not.toBe("setup.baseUrl");
    expect(t("setup.baseUrl")).toBeDefined();
  });

  test("substitutes parameters into translated strings", () => {
    setLocale("en");
    expect(t("setup.invalidProtocol", { count: 5 })).toContain("5");
    expect(t("language.changed", { locale: "zh-CN" })).toContain("zh-CN");
  });

  test("switches locale back and forth", () => {
    setLocale("en");
    const english = t("setup.saved", { path: "/tmp/config.yaml" });
    setLocale("zh-CN");
    const chinese = t("setup.saved", { path: "/tmp/config.yaml" });
    expect(chinese).not.toBe(english);
    expect(chinese.length).toBeGreaterThan(0);
  });

  test("notifies subscribers when the locale changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    const nextLocale = getLocale() === "en" ? "zh-CN" : "en";

    setLocale(nextLocale);

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  test("translates every key in the groups the CLI renders directly", () => {
    const source = fs.readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf-8",
    );
    const keys = [
      ...new Set(
        [...source.matchAll(/^  "([A-Za-z0-9.]+)":/gm)].map(
          (match) => match[1],
        ),
      ),
    ];
    // Keys whose Chinese and English text are legitimately the same, e.g. a
    // value that is only a symbol or a URL. Adding one here is a deliberate act.
    const intentionallyIdentical = new Set<string>();
    const groups = [
      "review.",
      "checks.",
      "chat.",
      "serve.",
      "startup.",
      "plugin.",
      "session.",
      "skills.",
      "outputStyle.",
      "diagnostics.",
      "tool.",
      "models.",
      "mcp.",
      "common.",
      "update.",
      "debug.",
      "jobs.",
      "permission.",
      "edit.",
      "goal.",
      "selector.",
      "quiz.",
    ];
    const targeted = keys.filter((key) =>
      groups.some((group) => key.startsWith(group)),
    );
    expect(targeted.length).toBeGreaterThan(50);

    for (const key of targeted) {
      if (intentionallyIdentical.has(key)) continue;
      setLocale("en");
      const english = t(key as never);
      setLocale("zh-CN");
      const chinese = t(key as never);
      expect(english, key).not.toBe(key);
      expect(chinese, key).not.toBe(key);
      expect(chinese, key).not.toBe(english);
    }
  });

  test("restores the pre-test locale for other suites", () => {
    setLocale(originalLocale);
    expect(getLocale()).toBe(originalLocale);
  });
});
