import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "../i18n/index.js";
import { waitForCondition } from "../test-utils/TUIChat.testHelper.js";

import { SlashCommandUI } from "./SlashCommandUI.js";

describe("SlashCommandUI locale", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("reloads command descriptions and navigation text after a locale switch", async () => {
    setLocale("zh-CN");
    const { lastFrame } = render(
      <SlashCommandUI assistant={{} as any} filter="" selectedIndex={0} />,
    );

    await waitForCondition(() => lastFrame()?.includes("语言") ?? false);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("↑/↓ 选择");
    expect(frame).not.toContain("Language");
  });
});
