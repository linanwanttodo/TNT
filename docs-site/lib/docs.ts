import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { NavItem, NavTab } from "@/config/docsNav";
import { DEFAULT_LOCALE, type Locale } from "./i18n";

const DOCS_DIR = process.env.DOCS_DIR || path.resolve(process.cwd(), "../docs");

export function getDocsDir() {
  return DOCS_DIR;
}

function docsLocaleDir(locale: Locale): string {
  return locale === "zh" ? path.join(DOCS_DIR, "zh") : DOCS_DIR;
}

/**
 * Doc slugs arrive from URL route params and snippet names from MDX content,
 * so a `../` inside one must not walk the reader out of the docs tree. The
 * judgment runs on the resolved path, so a normalized escape is caught even
 * when the raw string never spelled one out.
 */
function resolveWithinDocs(root: string, candidate: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(resolvedRoot + path.sep)
  ) {
    return null;
  }
  return resolved;
}

export function loadDocsNav(locale: Locale = DEFAULT_LOCALE): NavTab[] {
  const docsJsonPath = path.join(
    DOCS_DIR,
    locale === "zh" ? "docs.zh.json" : "docs.json",
  );
  if (!fs.existsSync(docsJsonPath)) {
    console.warn(`docs nav not found at ${docsJsonPath}, using empty nav`);
    return [];
  }

  const raw = JSON.parse(fs.readFileSync(docsJsonPath, "utf8"));
  return raw.navigation?.tabs ?? [];
}

export function loadDocsRedirects(
  locale: Locale = DEFAULT_LOCALE,
): Map<string, string> {
  const docsJsonPath = path.join(
    DOCS_DIR,
    locale === "zh" ? "docs.zh.json" : "docs.json",
  );
  if (!fs.existsSync(docsJsonPath)) return new Map();

  const raw = JSON.parse(fs.readFileSync(docsJsonPath, "utf8"));
  const redirects = new Map<string, string>();
  for (const entry of raw.redirects ?? []) {
    const source = (entry.source as string).replace(/^\//, "");
    redirects.set(source, entry.destination as string);
  }
  return redirects;
}

// Whitelist of allowed external redirect domains. Empty on purpose: the docs
// site only redirects inside itself, so an external destination is refused.
const ALLOWED_REDIRECT_DOMAINS: string[] = [];

export function resolveDocsRedirect(
  slug: string[],
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const key = slug.join("/");
  const dest = loadDocsRedirects(locale).get(key);
  if (!dest) return null;

  // Handle external URLs
  if (dest.startsWith("https://") || dest.startsWith("http://")) {
    try {
      const url = new URL(dest);
      // Only allow redirects to whitelisted domains
      if (!ALLOWED_REDIRECT_DOMAINS.includes(url.hostname)) {
        console.warn(`Blocked redirect to untrusted domain: ${url.hostname}`);
        return null;
      }
      return dest;
    } catch {
      console.warn(`Invalid redirect URL: ${dest}`);
      return null;
    }
  }

  // Internal redirects - ensure they start with /
  return dest.startsWith("/") ? dest : `/${dest}`;
}

export interface DocFile {
  frontmatter: Record<string, any>;
  content: string;
  slug: string[];
}

export async function loadMdxFile(
  slug: string[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<DocFile | null> {
  const slugPath = slug.join("/");
  const base = docsLocaleDir(locale);
  // Slugs come from URL route params: anchor every read to the docs tree so
  // a `../` inside a slug cannot walk the reader out of it. The containment
  // is judged on the resolved path, not a raw-prefix startswith.
  const resolvedBase = path.resolve(base);
  const within = (candidate: string) =>
    candidate === resolvedBase || candidate.startsWith(resolvedBase + path.sep);
  const filePath = path.resolve(resolvedBase, slugPath + ".mdx");
  if (within(filePath) && fs.existsSync(filePath)) {
    return readDocFile(filePath, slug);
  }

  // Try index.mdx inside directory
  const indexPath = path.resolve(
    resolvedBase,
    path.join(slugPath, "index.mdx"),
  );
  if (within(indexPath) && fs.existsSync(indexPath)) {
    return readDocFile(indexPath, slug);
  }

  // A missing translation falls back to English rather than a 404.
  if (locale !== DEFAULT_LOCALE) {
    const fallbackRoot = path.resolve(DOCS_DIR);
    const withinRoot = (candidate: string) =>
      candidate === fallbackRoot ||
      candidate.startsWith(fallbackRoot + path.sep);
    const fallback = path.resolve(fallbackRoot, slugPath + ".mdx");
    if (withinRoot(fallback) && fs.existsSync(fallback)) {
      return readDocFile(fallback, slug);
    }
    const fallbackIndex = path.resolve(
      fallbackRoot,
      path.join(slugPath, "index.mdx"),
    );
    if (withinRoot(fallbackIndex) && fs.existsSync(fallbackIndex)) {
      return readDocFile(fallbackIndex, slug);
    }
  }

  return null;
}

export async function loadRawMdxFile(
  slug: string[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ raw: string; fileName: string } | null> {
  const slugPath = slug.join("/");
  const base = docsLocaleDir(locale);

  // Prevent path traversal — anchor the read to the docs tree, judged on the
  // resolved path rather than a raw-prefix startswith. A `../` inside a slug
  // resolves outside and is refused here.
  const resolvedBase = path.resolve(base);
  const within = (candidate: string) =>
    candidate === resolvedBase || candidate.startsWith(resolvedBase + path.sep);
  const filePath = path.resolve(resolvedBase, slugPath + ".mdx");
  if (within(filePath) && fs.existsSync(filePath)) {
    return {
      raw: fs.readFileSync(filePath, "utf8"),
      fileName: slug[slug.length - 1] + ".md",
    };
  }

  const indexPath = path.resolve(
    resolvedBase,
    path.join(slugPath, "index.mdx"),
  );
  if (within(indexPath) && fs.existsSync(indexPath)) {
    return {
      raw: fs.readFileSync(indexPath, "utf8"),
      fileName: slug[slug.length - 1] + ".md",
    };
  }

  return null;
}

function readDocFile(filePath: string, slug: string[]): DocFile {
  const raw = fs.readFileSync(filePath, "utf8");
  const { data: frontmatter, content } = matter(raw);

  const processed = preprocessMdx(content, slug);

  return { frontmatter, content: processed, slug };
}

/**
 * Preprocess MDX content:
 * 1. Find MDX snippet imports (import X from '/snippets/foo.mdx')
 * 2. Inline the snippet content in place of <X /> usage
 * 3. Strip JSX component imports (handled via components map)
 */
function preprocessMdx(content: string, slug: string[]): string {
  // Collect MDX snippet imports: import Name from '/snippets/file.mdx'
  const mdxImportRegex =
    /^import\s+(\w+)\s+from\s+['"]\/snippets\/([^'"]+\.mdx)['"];?\s*$/gm;
  const snippets = new Map<string, string>();
  let match;

  while ((match = mdxImportRegex.exec(content)) !== null) {
    const componentName = match[1]!;
    const snippetFile = match[2]!;
    // The snippet name comes from MDX content: only a plain relative path of
    // safe segments is accepted, and the resolved file must land inside the
    // snippets directory.
    if (
      !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.mdx$/.test(snippetFile) ||
      snippetFile.includes("..")
    ) {
      continue;
    }
    // Resolved containment: the snippet must land inside the snippets dir.
    const snippetsRoot = path.resolve(DOCS_DIR, "snippets");
    const snippetPath = path.resolve(snippetsRoot, snippetFile);
    if (
      snippetPath !== snippetsRoot &&
      !snippetPath.startsWith(snippetsRoot + path.sep)
    ) {
      continue;
    }

    if (fs.existsSync(snippetPath)) {
      const snippetRaw = fs.readFileSync(snippetPath, "utf8");
      const { content: snippetContent } = matter(snippetRaw);
      snippets.set(componentName, snippetContent.trim());
    }
  }

  let result = content;

  // Replace <SnippetName /> with inlined content
  for (const [name, body] of Array.from(snippets.entries())) {
    const selfClosing = new RegExp(`<${name}\\s*/>`, "g");
    const withChildren = new RegExp(`<${name}\\s*>[\\s\\S]*?</${name}>`, "g");
    result = result.replace(selfClosing, body);
    result = result.replace(withChildren, body);
  }

  // Strip all remaining import statements (JSX snippets handled via components map)
  result = result.replace(/^import\s+.*from\s+['"].*['"];?\s*$/gm, "");

  // Convert :::warning / :::info / :::tip admonitions to JSX components
  result = result.replace(
    /^:::(warning|info|tip|note|danger)\s*\n([\s\S]*?)^:::\s*$/gm,
    (_match, type: string, body: string) => {
      const tag = type.charAt(0).toUpperCase() + type.slice(1);
      return `<${tag}>${body.trim()}</${tag}>`;
    },
  );

  // Ensure --- horizontal rules have blank lines before them
  // (prevents Setext h2 interpretation when preceded by text)
  // Only apply outside of fenced code blocks.
  result = result.replace(
    /(```[\s\S]*?```)|([^\n])\n---\n/g,
    (match, codeBlock, prev) => {
      if (codeBlock) return codeBlock; // leave code blocks untouched
      return `${prev}\n\n---\n`;
    },
  );

  // Rewrite image paths: /images/... → /images/docs/...
  result = result.replace(/src=["']\/images\//g, 'src="/images/docs/');

  // Rewrite markdown image paths: ![alt](/images/...) → ![alt](/images/docs/...)
  result = result.replace(/\]\(\/images\//g, "](/images/docs/");

  // Rewrite relative image paths: ![alt](../images/...) → ![alt](/images/docs/...)
  // Resolve relative to the current file's directory
  const fileDir = slug.slice(0, -1).join("/");
  result = result.replace(
    /\]\((\.\.?\/[^)]*\.(png|jpg|jpeg|gif|svg|webp))\)/gi,
    (_match, relPath: string) => {
      const resolved = path.posix.normalize(
        fileDir ? `${fileDir}/${relPath}` : relPath,
      );
      return `](/images/docs/${resolved})`;
    },
  );

  return result;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export function getHeadings(content: string): Heading[] {
  const regex = /^(#{2,4})\s+(.+)$/gm;
  const headings: Heading[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    const level = match[1]!.length;
    const text = match[2]!.trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    headings.push({ level, text, id });
  }

  return headings;
}

export function getAllDocSlugs(nav: NavTab[] = loadDocsNav()): string[] {
  const slugs: string[] = [];
  function walk(items: NavItem[]) {
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

/**
 * Build a map of slug → display title by reading frontmatter from all docs.
 * Prefers sidebarTitle over title, falls back to slug-derived name.
 */
export function getAllDocTitles(
  locale: Locale = DEFAULT_LOCALE,
): Record<string, string> {
  const slugs = getAllDocSlugs(loadDocsNav(locale));
  const titles: Record<string, string> = {};
  const base = docsLocaleDir(locale);

  for (const slug of slugs) {
    // Slugs come from the docs nav file; anchor every read to the docs tree
    // so a `../` in a nav entry cannot walk the reader out of it.
    const resolvedRoot = path.resolve(base);
    const direct = path.resolve(resolvedRoot, slug + ".mdx");
    const index = path.resolve(resolvedRoot, path.join(slug, "index.mdx"));
    const within = (candidate: string) =>
      candidate === resolvedRoot ||
      candidate.startsWith(resolvedRoot + path.sep);

    let resolved: string | null = null;
    if (within(direct) && fs.existsSync(direct)) resolved = direct;
    else if (within(index) && fs.existsSync(index)) resolved = index;

    if (resolved) {
      const raw = fs.readFileSync(resolved, "utf8");
      const { data } = matter(raw);
      const title = data.sidebarTitle || data.title;
      if (title) {
        titles[slug] = title;
      }
    }
  }

  return titles;
}
