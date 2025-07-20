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

  test("restores the pre-test locale for other suites", () => {
    setLocale(originalLocale);
    expect(getLocale()).toBe(originalLocale);
  });
});
