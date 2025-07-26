import { act } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, t, type Locale } from "../../i18n/index.js";
import { useLocale } from "./useLocale.js";

const LocaleText: React.FC = () => {
  const locale = useLocale();
  return <Text>{`${t("intro.config")} ${locale}`}</Text>;
};

describe("useLocale", () => {
  const originalLocale: Locale = getLocale();

  afterEach(() => {
    act(() => setLocale(originalLocale));
  });

  it("re-renders translated UI when the locale changes", () => {
    act(() => setLocale("en"));
    const { lastFrame } = render(<LocaleText />);

    expect(lastFrame()).toContain("Config en");

    act(() => setLocale("zh-CN"));

    expect(lastFrame()).not.toContain("Config");
    expect(lastFrame()).toContain("zh-CN");
  });
});
