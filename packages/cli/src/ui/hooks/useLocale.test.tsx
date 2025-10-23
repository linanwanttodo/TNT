import { Text } from "ink";
import { render } from "ink-testing-library";
import { act } from "react";
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
  const trees: { unmount: () => void }[] = [];

  afterEach(() => {
    while (trees.length) {
      trees.pop()?.unmount();
    }
    act(() => setLocale(originalLocale));
  });

  it("re-renders translated UI when the locale changes", () => {
    act(() => setLocale("en"));
    const tree = render(<LocaleText />);
    trees.push(tree);

    expect(tree.lastFrame()).toContain("Config en");

    act(() => setLocale("zh-CN"));

    expect(tree.lastFrame()).not.toContain("Config");
    expect(tree.lastFrame()).toContain("zh-CN");
  });
});
