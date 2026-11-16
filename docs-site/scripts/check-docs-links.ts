/**
 * Build-time guard: every page named by a docs nav config must resolve to an
 * MDX file, and every internal link in those pages must resolve too. A stale
 * entry renders a link to the 404 page, which is what a reader sees as
 * "clicked a jump and landed on nothing".
 *
 * Run via: npx tsx scripts/check-docs-links.ts
 */
import fs from "fs";
import path from "path";
import { checkRedirectDestination } from "../lib/redirectHost";

const DOCS_DIR = path.resolve(__dirname, "../../docs");
const LOCALES = ["en", "zh"] as const;
type Locale = (typeof LOCALES)[number];

interface NavGroup {
  group?: string;
  pages?: NavItem[];
}
type NavItem = string | NavGroup;

function navSlugs(nav: Array<{ groups?: NavGroup[] }>): string[] {
  const slugs: string[] = [];
  const walk = (items: NavItem[]) => {
    for (const item of items) {
      if (typeof item === "string") slugs.push(item);
      else if (item.pages) walk(item.pages);
    }
  };
  for (const tab of nav) walk(tab.groups ?? []);
  return Array.from(new Set(slugs));
}

function localeRoot(locale: Locale): string {
  return locale === "zh" ? path.join(DOCS_DIR, "zh") : DOCS_DIR;
}

const LINK_PATTERNS = [
  /(?<!\!)\[[^\]]*\]\((\/[^)\s#]+)/,
  /href="(\/[^"\s#]+)"/,
];

function internalTargets(file: string, locale: Locale): string[] {
  const content = fs.readFileSync(file, "utf8");
  const targets: string[] = [];
  for (const line of content.split("\n")) {
    for (const pattern of LINK_PATTERNS) {
      const found = line.match(pattern);
      if (!found) continue;
      const relative = found[1].replace(/^\//, "");
      const withoutLocale =
        locale === "zh" && relative.startsWith("zh/")
          ? relative.slice(3)
          : relative;
      const root = localeRoot(locale);
      if (!fs.existsSync(path.join(root, `${withoutLocale}.mdx`))) {
        targets.push(relative);
      }
    }
  }
  return targets;
}

const problems: string[] = [];
for (const locale of LOCALES) {
  const config = path.join(
    DOCS_DIR,
    locale === "zh" ? "docs.zh.json" : "docs.json",
  );
  if (!fs.existsSync(config)) {
    problems.push(`missing nav config: ${config}`);
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(config, "utf8"));
  for (const entry of raw.redirects ?? []) {
    const check = checkRedirectDestination(entry.destination as string);
    if (!check.ok) {
      problems.push(`[${locale}] redirect ${entry.source}: ${check.reason}`);
    }
  }
  const nav = raw.navigation?.tabs ?? [];
  const root = localeRoot(locale);
  for (const slug of navSlugs(nav)) {
    const file = path.join(root, `${slug}.mdx`);
    if (!fs.existsSync(file)) {
      problems.push(`[${locale}] nav page missing: ${slug}`);
      continue;
    }
    for (const broken of internalTargets(file, locale)) {
      problems.push(`[${locale}] ${slug} links to missing page: ${broken}`);
    }
  }

  const home = path.join(root, "index.mdx");
  if (fs.existsSync(home)) {
    for (const broken of internalTargets(home, locale)) {
      problems.push(`[${locale}] index links to missing page: ${broken}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`docs link check failed: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("docs link check: all nav pages and internal links resolve");
