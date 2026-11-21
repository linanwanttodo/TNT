import fs from "fs";
import path from "path";

import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useState } from "react";

import {
  getProjectSettingsPath,
  readSettingsString,
  writeSettingsValue,
} from "../../config/settingsFiles.js";
import { t } from "../../i18n/index.js";
import { symbols } from "../symbols.js";
import {
  getTheme,
  themeFileFor,
  useTheme,
  type Theme,
  type ThemeName,
} from "../theme/tokens.js";

import { ToolDiffView } from "./ToolDiffView.js";

export interface ThemeOption {
  id: string;
  name: string;
  themeName: ThemeName | "auto" | "custom";
}

interface ThemeSelectorProps {
  /** Applies a theme for preview; the caller owns the provider state. */
  onPreview: (themeName: ThemeName | "auto") => void;
  /** Restores the theme that was active before the selector opened. */
  onCancel: () => void;
  /** Commits the choice: persist it and leave the preview in place. */
  onSelect: (themeName: ThemeName | "auto") => void;
}

/**
 * The selectable theme list, in Claude Code's order. The theme governs how
 * the transcript renders code: syntax highlighting and diff colours - the
 * preview below the list shows exactly that, live.
 */
const THEME_OPTIONS: ThemeOption[] = [
  { id: "auto", name: t("theme.auto"), themeName: "auto" },
  { id: "dark", name: t("theme.dark"), themeName: "dark" },
  { id: "light", name: t("theme.light"), themeName: "light" },
  {
    id: "dark-colorblind",
    name: t("theme.darkColorblind"),
    themeName: "dark-colorblind",
  },
  {
    id: "light-colorblind",
    name: t("theme.lightColorblind"),
    themeName: "light-colorblind",
  },
  { id: "dark-ansi", name: t("theme.darkAnsi"), themeName: "dark-ansi" },
  { id: "light-ansi", name: t("theme.lightAnsi"), themeName: "light-ansi" },
  { id: "__custom__", name: t("theme.custom"), themeName: "custom" },
];

const SAMPLE_DIFF = `diff --git a/greet.js b/greet.js
index 83db48f..bf2d4f3 100644
--- a/greet.js
+++ b/greet.js
@@ -1,3 +1,3 @@
 function greet() {
-  return "Hello, World!";
+  return "Hello, Claude!";
 }`;

/** Resolves the active display theme to the option that represents it. */
export function themeOptionId(theme: Theme): string {
  for (const option of THEME_OPTIONS) {
    if (
      option.id !== "__custom__" &&
      theme === getTheme(option.themeName as ThemeName)
    ) {
      return option.id;
    }
  }
  return "dark";
}

/**
 * The theme picker, matching Claude Code's /theme: the option list governs
 * how the transcript renders code (syntax highlighting and diff colours), the
 * highlighted option previews live, and ctrl+t flips the syntax palette off
 * to judge the diff colours on their own.
 */
export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  onPreview,
  onCancel,
  onSelect,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentTheme = useTheme();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [syntaxEnabled, setSyntaxEnabled] = useState(true);
  const { stdout } = useStdout();
  const columns = Math.max(20, (stdout?.columns ?? 80) - 4);
  const marks = symbols();

  // The persisted choice is the marker for which row is "current": the
  // preview may repaint the whole UI, but the saved setting is what the next
  // session opens with.
  useEffect(() => {
    const saved = readSettingsString("theme");
    setCurrentId(
      saved && THEME_OPTIONS.some((option) => option.id === saved)
        ? saved
        : themeOptionId(currentTheme),
    );
  }, [currentTheme]);

  const selectedOption = THEME_OPTIONS[selectedIndex];
  const previewedTheme = getTheme(
    selectedOption && selectedOption.id !== "__custom__"
      ? (selectedOption.themeName as ThemeName)
      : undefined,
  );

  const preview = (index: number): void => {
    const option = THEME_OPTIONS[index];
    if (option && option.id !== "__custom__") {
      onPreview(option.themeName as ThemeName | "auto");
    }
  };

  const commitCustom = (): void => {
    // Create ~/.tnt/themes/custom.json from the previewed palette so the
    // user has a real file to edit; the picker then selects it.
    const file = themeFileFor("custom");
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const palette = {
        accent: currentTheme.accent,
        user: currentTheme.user,
        claude: currentTheme.claude,
        claudeShimmer: currentTheme.claudeShimmer,
        permission: currentTheme.permission,
        suggestion: currentTheme.suggestion,
        text: { ...currentTheme.text },
        status: { ...currentTheme.status },
        border: { ...currentTheme.border },
        background: { ...currentTheme.background },
        tool: { ...currentTheme.tool },
        diff: { ...currentTheme.diff },
        syntax: { ...currentTheme.syntax },
      };
      fs.writeFileSync(file, JSON.stringify(palette, null, 2));
      writeSettingsValue(getProjectSettingsPath(), "theme", "custom");
      onSelect("custom" as ThemeName);
    } catch {
      onSelect(selectedOption?.themeName ?? "dark");
    }
  };

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }

    if (key.return) {
      const option = THEME_OPTIONS[selectedIndex];
      if (!option) return;
      if (option.id === "__custom__") {
        commitCustom();
        return;
      }
      onSelect(option.themeName as ThemeName | "auto");
      return;
    }

    if (key.ctrl && input === "t") {
      setSyntaxEnabled((v) => !v);
      return;
    }

    if (key.upArrow) {
      const next =
        selectedIndex === 0 ? THEME_OPTIONS.length - 1 : selectedIndex - 1;
      setSelectedIndex(next);
      preview(next);
    } else if (key.downArrow) {
      const next =
        selectedIndex === THEME_OPTIONS.length - 1 ? 0 : selectedIndex + 1;
      setSelectedIndex(next);
      preview(next);
    }
  });

  const divider = "─".repeat(Math.max(20, Math.floor(columns / 2)));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={currentTheme.border.default}
      paddingX={1}
    >
      <Text color={currentTheme.accent} bold>
        {t("theme.title")}
      </Text>
      <Text color={currentTheme.text.primary}>{t("theme.subtitle")}</Text>
      <Text> </Text>

      {THEME_OPTIONS.map((option, index) => {
        const isSelected = index === selectedIndex;
        const isCurrent = currentId === option.id;
        const isCustom = option.id === "__custom__";
        return (
          <Text key={option.id}>
            <Text
              color={
                isSelected
                  ? currentTheme.text.primary
                  : currentTheme.background.composer
              }
              bold={isSelected}
            >
              {isSelected ? `${marks.selected} ` : "  "}
            </Text>
            <Text
              color={
                isCurrent && !isSelected
                  ? currentTheme.status.success
                  : currentTheme.background.composer
              }
              bold
            >
              {isCurrent ? `${marks.check} ` : "  "}
            </Text>
            <Text
              color={
                isCustom
                  ? currentTheme.text.secondary
                  : currentTheme.text.primary
              }
              bold={isSelected && !isCustom}
            >
              {option.name}
            </Text>
          </Text>
        );
      })}

      <Text dimColor>{divider}</Text>

      <Box paddingX={1}>
        <ToolDiffView
          diffContent={SAMPLE_DIFF}
          expanded
          customTheme={
            syntaxEnabled
              ? previewedTheme
              : {
                  ...previewedTheme,
                  syntax: {
                    keyword: previewedTheme.text.primary,
                    string: previewedTheme.text.primary,
                    comment: previewedTheme.text.secondary,
                    number: previewedTheme.text.primary,
                    operator: previewedTheme.text.primary,
                    punctuation: previewedTheme.text.primary,
                    function: previewedTheme.text.primary,
                    variable: previewedTheme.text.primary,
                    property: previewedTheme.text.primary,
                    class: previewedTheme.text.primary,
                    constant: previewedTheme.text.primary,
                    regex: previewedTheme.text.primary,
                    default: previewedTheme.text.primary,
                  },
                }
          }
        />
      </Box>

      <Text dimColor>{divider}</Text>

      <Text color={currentTheme.text.secondary}>
        {t("theme.syntaxLine", {
          name: syntaxEnabled ? previewedTheme.syntaxName : "none",
          action: syntaxEnabled
            ? t("theme.syntaxDisable")
            : t("theme.syntaxEnable"),
        })}
      </Text>
      <Text italic color={currentTheme.text.secondary}>
        {t("theme.footer")}
      </Text>
    </Box>
  );
};

/** Persists a theme choice the way the picker commits it. */
export function persistThemeChoice(themeName: ThemeName | "auto"): void {
  writeSettingsValue(getProjectSettingsPath(), "theme", themeName);
}

/** The theme choice the picker should highlight as saved. */
export function readPersistedTheme(): ThemeName | "auto" | undefined {
  const saved = readSettingsString("theme");
  if (!saved) {
    return undefined;
  }
  const normalized = saved.toLowerCase().trim();
  if (THEME_OPTIONS.some((option) => option.id === normalized)) {
    return normalized as ThemeName | "auto";
  }
  // A saved name that is not built in is kept when its file is there, so a
  // theme the user wrote themselves survives a restart.
  return fs.existsSync(themeFileFor(normalized))
    ? (normalized as ThemeName)
    : undefined;
}

/** Resolves a picker choice to the theme it selects. */
export function themeOfChoice(
  choice: ThemeName | "auto",
  detectedIsDark: boolean | undefined,
): Theme {
  if (choice === "auto") {
    return getTheme(detectedIsDark === false ? "light" : "dark");
  }
  return getTheme(choice);
}
