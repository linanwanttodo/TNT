import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { getLocalStorage, setLocalStorage } from "../util/localStorage";
import { en, TranslationKey } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

export type Locale = "en" | "zh-CN";
export type LanguageSetting = Locale | "auto";

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  en,
  "zh-CN": zhCN,
};

function detectLocale(): Locale {
  const candidates =
    typeof navigator !== "undefined" && navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
  for (const tag of candidates) {
    const lower = tag.toLowerCase();
    if (lower.startsWith("zh")) {
      return "zh-CN";
    }
    if (lower.startsWith("en")) {
      return "en";
    }
  }
  return "en";
}

interface I18nContextValue {
  language: LanguageSetting;
  locale: Locale;
  setLanguage: (language: LanguageSetting) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageSetting>(
    () => getLocalStorage("uiLanguage") ?? "auto",
  );

  const locale = language === "auto" ? detectLocale() : language;

  const setLanguage = useCallback((next: LanguageSetting) => {
    setLocalStorage("uiLanguage", next);
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const text =
        (DICTIONARIES[locale] as Record<string, string>)[key] ??
        (en as Record<string, string>)[key] ??
        key;
      if (!params) {
        return text;
      }
      return Object.entries(params).reduce(
        (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
        text,
      );
    },
    [locale],
  );

  const value = useMemo(
    () => ({ language, locale, setLanguage, t }),
    [language, locale, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
