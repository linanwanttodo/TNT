import { resolveHref } from "./resolveHref";

export type Locale = "en" | "zh";

export const DEFAULT_LOCALE: Locale = "en";

export function localeFromSlug(slug: string[] | undefined): Locale {
  return slug?.[0] === "zh" ? "zh" : DEFAULT_LOCALE;
}

/** The page slug without the leading locale segment. */
export function pageSlugFromRoute(slug: string[] | undefined): string[] {
  if (!slug || slug.length === 0) return ["index"];
  if (slug[0] === "zh") {
    return slug.length > 1 ? slug.slice(1) : ["index"];
  }
  return slug;
}

export function otherLocale(locale: Locale): Locale {
  return locale === "zh" ? "en" : "zh";
}

/** Internal href for a page in a locale, without the deploy base path. */
export function docPath(locale: Locale, slug: string): string {
  if (slug === "index") return locale === "zh" ? "/zh" : "/";
  return resolveHref(`/docs/${locale === "zh" ? "zh/" : ""}${slug}`);
}

export function localeRoot(locale: Locale): string {
  return locale === "zh" ? "/zh" : "/";
}

export const UI = {
  en: {
    docs: "Docs",
    github: "GitHub",
    search: "Search...",
    searchPlaceholder: "Search documentation...",
    searchLoading: "Loading search index...",
    noResults: "No results found.",
    results: "Results",
    allPages: "All pages",
    copyPage: "Copy page",
    copied: "Copied",
    onThisPage: "On this page",
    toggleTheme: "Toggle theme",
    language: "Switch language",
  },
  zh: {
    docs: "文档",
    github: "GitHub",
    search: "搜索",
    searchPlaceholder: "搜索文档...",
    searchLoading: "正在加载搜索索引...",
    noResults: "没有找到结果。",
    results: "搜索结果",
    allPages: "全部页面",
    copyPage: "复制页面",
    copied: "已复制",
    onThisPage: "本页内容",
    toggleTheme: "切换主题",
    language: "切换语言",
  },
} as const;
