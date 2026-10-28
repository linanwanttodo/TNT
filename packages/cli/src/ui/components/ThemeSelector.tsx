import fs from "fs";

import React, { useEffect, useState } from "react";

import {
  getProjectSettingsPath,
  readSettingsString,
  writeSettingsValue,
} from "../../config/settingsFiles.js";
import { t } from "../../i18n/index.js";
import { Selector, type SelectorOption } from "../Selector.js";
import {
  getTheme,
  themeFileFor,
  useTheme,
  type Theme,
  type ThemeName,
} from "../theme/tokens.js";

export interface ThemeOption extends SelectorOption {
  themeName: ThemeName | "auto";
}

interface ThemeSelectorProps {
  /** Applies a theme for preview; the caller owns the provider state. */
  onPreview: (themeName: ThemeName | "auto") => void;
  /** Restores the theme that was active before the selector opened. */
  onCancel: () => void;
  /** Commits the choice: persist it and leave the preview in place. */
  onSelect: (themeName: ThemeName | "auto") => void;
}

/** The selectable theme list, in the order the picker shows them. */
const THEME_OPTIONS: ThemeOption[] = [
  { id: "auto", name: t("theme.auto"), themeName: "auto" },
  { id: "dark", name: "dark", themeName: "dark" },
  { id: "tencent-dark", name: "tencent-dark", themeName: "tencent-dark" },
  { id: "tencent-light", name: "tencent-light", themeName: "tencent-light" },
  { id: "light", name: "light", themeName: "light" },
];

/** Resolves the active display theme to the option that represents it. */
export function themeOptionId(theme: Theme): string {
  if (theme === getTheme("light")) {
    return "light";
  }
  if (theme === getTheme("tencent-light")) {
    return "tencent-light";
  }
  if (theme === getTheme("tencent-dark")) {
    return "tencent-dark";
  }
  return "dark";
}

/**
 * The theme picker. Moving the cursor previews the highlighted theme in
 * place - the whole UI recolours while the selector is open - and Esc rolls
 * back to whatever was active before. Enter persists the choice to the
 * project settings file, where it outranks any config-file theme.
 */
export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  onPreview,
  onCancel,
  onSelect,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentTheme = useTheme();
  const [currentId, setCurrentId] = useState<string | null>(null);

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

  const preview = (index: number): void => {
    const option = THEME_OPTIONS[index];
    if (option) {
      onPreview(option.themeName);
    }
  };

  return (
    <Selector<ThemeOption>
      title={t("theme.title")}
      options={THEME_OPTIONS}
      selectedIndex={selectedIndex}
      loading={false}
      error={null}
      currentId={currentId}
      onSelect={(option) => onSelect(option.themeName)}
      onCancel={onCancel}
      onNavigate={(index) => {
        setSelectedIndex(index);
        preview(index);
      }}
    />
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
