import { create } from "zustand";

export type ThemeChoice = "dark" | "light" | "system";
export type UiLanguage = "en" | "zh";

const THEME_KEY = "tnt-webui-theme";
const LANGUAGE_KEY = "tnt-webui-language";

function readTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "system" || value === "dark"
      ? value
      : "dark";
  } catch {
    return "dark";
  }
}

function readLanguage(): UiLanguage {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const systemDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = choice === "dark" || (choice === "system" && systemDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

interface UiPreferencesState {
  theme: ThemeChoice;
  language: UiLanguage;
  setTheme: (theme: ThemeChoice) => void;
  setLanguage: (language: UiLanguage) => void;
}

const initialTheme = readTheme();
if (typeof document !== "undefined") {
  applyTheme(initialTheme);
}

export const useUiPreferences = create<UiPreferencesState>()((set) => ({
  theme: initialTheme,
  language: readLanguage(),
  setTheme: (theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The preference still applies for this page view.
    }
    applyTheme(theme);
    set({ theme });
  },
  setLanguage: (language) => {
    try {
      window.localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // The preference still applies for this page view.
    }
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    set({ language });
  },
}));

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (useUiPreferences.getState().theme === "system") {
        applyTheme("system");
      }
    });
}
