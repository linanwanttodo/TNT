/**
 * Build-time script that generates the Orama search index as a static JSON file.
 * Run via: npx tsx scripts/build-search-index.ts
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { create, insert, save } from "@orama/orama";

const DOCS_DIR = path.resolve(__dirname, "../../docs");
const LOCALES = ["en", "zh"] as const;
type Locale = (typeof LOCALES)[number];

function loadDocsNav(locale: Locale) {
  const docsJsonPath = path.join(
    DOCS_DIR,
    locale === "zh" ? "docs.zh.json" : "docs.json",
  );
  if (!fs.existsSync(docsJsonPath)) return [];
  const raw = JSON.parse(fs.readFileSync(docsJsonPath, "utf8"));
  return raw.navigation?.tabs ?? [];
}

function getAllDocSlugs(nav: any[]): string[] {
  const slugs: string[] = [];
  function walk(items: any[]) {
    for (const item of items) {
      if (typeof item === "string") slugs.push(item);
      else if (item.pages) walk(item.pages);
    }
  }
  for (const tab of nav) {
    for (const group of tab.groups) {
      walk(group.pages);
    }
  }
  return Array.from(new Set(slugs));
}

function stripMdx(content: string): string {
  // Iteratively strip HTML tags to handle nested/malformed tags
  let stripped = content;
  let prev = "";
  while (prev !== stripped) {
    prev = stripped;
    stripped = stripped.replace(/<[^>]+>/g, "");
  }
  return stripped
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function loadMdxFile(slug: string, locale: Locale) {
  const base = locale === "zh" ? path.join(DOCS_DIR, "zh") : DOCS_DIR;
  const filePath = path.join(base, slug + ".mdx");
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data, content } = matter(raw);
    return { frontmatter: data, content };
  }
  const indexPath = path.join(base, slug, "index.mdx");
  if (fs.existsSync(indexPath)) {
    const raw = fs.readFileSync(indexPath, "utf8");
    const { data, content } = matter(raw);
    return { frontmatter: data, content };
  }
  // Fall back to English so a missing translation is still searchable.
  if (locale !== "en") return loadMdxFile(slug, "en");
  return null;
}

async function main() {
  const outDir = path.resolve(__dirname, "../public");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const locale of LOCALES) {
    const nav = loadDocsNav(locale);
    const slugs = getAllDocSlugs(nav);

    const db = create({
      schema: {
        title: "string" as const,
        path: "string" as const,
        content: "string" as const,
        section: "string" as const,
      },
    });

    for (const slug of slugs) {
      const doc = loadMdxFile(slug, locale);
      if (!doc) continue;

      const title =
        doc.frontmatter.title ||
        slug
          .split("/")
          .pop()!
          .replace(/^\d+-/, "")
          .replace(/-/g, " ")
          .replace(/\b\w/g, (l: string) => l.toUpperCase());

      const section = slug.split("/")[0] || "docs";
      const plainText = stripMdx(doc.content);

      insert(db, { title, path: slug, content: plainText, section });
    }

    const data = save(db);
    const fileName =
      locale === "zh" ? "search-index.zh.json" : "search-index.json";
    fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(data));
    console.log(
      `Search index written to public/${fileName} (${slugs.length} docs, ${locale})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
