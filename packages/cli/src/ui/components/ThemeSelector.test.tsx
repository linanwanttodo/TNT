import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pressUntilMet, tick } from "../../../test-utils/renderPress.js";
import { writeSettingsValue } from "../../config/settingsFiles.js";
import { setLocale } from "../../i18n/index.js";
import { getTheme } from "../theme/tokens.js";

import {
  persistThemeChoice,
  readPersistedTheme,
  ThemeSelector,
  themeOfChoice,
} from "./ThemeSelector.js";

vi.mock("../../config/settingsFiles.js", () => ({
  getProjectSettingsPath: () => "/tmp/tnt-theme-test/settings.json",
  readSettingsString: vi.fn(() => undefined),
  writeSettingsValue: vi.fn(),
}));

const mockedWrite = vi.mocked(writeSettingsValue);

beforeEach(() => {
  mockedWrite.mockClear();
  setLocale("en");
});

function selectorFrame(
  callbacks: {
    onPreview?: (name: any) => void;
    onSelect?: (name: any) => void;
    onCancel?: () => void;
  } = {},
): string {
  const tree = render(
    <ThemeSelector
      onPreview={callbacks.onPreview ?? (() => {})}
      onSelect={callbacks.onSelect ?? (() => {})}
      onCancel={callbacks.onCancel ?? (() => {})}
    />,
  );
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("ThemeSelector", () => {
  it("lists auto and the four named themes with the picker hint", () => {
    const frame = selectorFrame();

    expect(frame).toContain("Theme");
    expect(frame).toContain("auto");
    expect(frame).toContain("dark");
    expect(frame).toContain("tencent-light");
    expect(frame).toContain("Enter to select");
  });

  it("previews on navigation and commits on Enter", async () => {
    const previews: string[] = [];
    const selections: string[] = [];

    const tree = render(
      <ThemeSelector
        onPreview={(name) => previews.push(name)}
        onSelect={(name) => selections.push(name)}
        onCancel={() => {}}
      />,
    );

    // Down twice: dark -> tencent-dark preview, then Enter commits. Each key is
    // waited for by its effect: a fixed sleep lost a keystroke on the Windows
    // lane and read as a selector that does not navigate.
    await pressUntilMet(tree, "\u001b[B", () => previews.includes("dark"));
    await pressUntilMet(tree, "\u001b[B", () =>
      previews.includes("tencent-dark"),
    );
    // The preview fires from the navigation callback; the index Enter reads is
    // committed a frame later. Delivery is the helper's business, this settle is
    // the component's.
    await tick(50);
    await pressUntilMet(tree, "\r", () => selections.length > 0);
    tree.unmount();

    expect(previews).toContain("dark");
    expect(previews).toContain("tencent-dark");
    expect(selections).toEqual(["tencent-dark"]);
  });
});

describe("persistThemeChoice / readPersistedTheme", () => {
  it("writes the choice to the project settings file", () => {
    persistThemeChoice("tencent-light");
    expect(mockedWrite).toHaveBeenCalledWith(
      "/tmp/tnt-theme-test/settings.json",
      "theme",
      "tencent-light",
    );
  });

  it("readPersistedTheme reports nothing to persist yet", () => {
    expect(readPersistedTheme()).toBeUndefined();
  });
});

describe("themeOfChoice", () => {
  it("resolves named choices directly", () => {
    expect(themeOfChoice("tencent-light", true)).toBe(
      getTheme("tencent-light"),
    );
    expect(themeOfChoice("dark", false)).toBe(getTheme("dark"));
  });

  it("resolves auto through the detected appearance", () => {
    expect(themeOfChoice("auto", false)).toBe(getTheme("light"));
    expect(themeOfChoice("auto", true)).toBe(getTheme("dark"));
    expect(themeOfChoice("auto", undefined)).toBe(getTheme("dark"));
  });
});
