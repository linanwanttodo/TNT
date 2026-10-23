import { compileMDX } from "next-mdx-remote/rsc";
import NotFoundPage from "@/app/components/NotFoundPage";
import { ClientRedirect } from "@/app/components/ClientRedirect";
import { Metadata } from "next/types";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrismPlus from "rehype-prism-plus";
import {
  loadMdxFile,
  getHeadings,
  getAllDocTitles,
  getAllDocSlugs,
  loadDocsNav,
  loadDocsRedirects,
  resolveDocsRedirect,
} from "@/lib/docs";
import { getPageNavigation } from "@/config/docsNav";
import { mdxComponents } from "@/components/docs/mdx";
import { DocsShell } from "@/components/docs/DocsShell";
import { PageNav } from "@/components/docs/PageNav";
import { CopyPageButton } from "@/components/docs/CopyPageButton";
import {
  docPath,
  localeFromSlug,
  pageSlugFromRoute,
  type Locale,
} from "@/lib/i18n";
import "../docs.css";

interface Props {
  params: Promise<{ slug?: string[] }>;
}

const LOCALES: Locale[] = ["en", "zh"];

export async function generateStaticParams() {
  const params: { slug: string[] }[] = [{ slug: [] }, { slug: ["zh"] }];

  for (const locale of LOCALES) {
    const nav = loadDocsNav(locale);
    const prefix = locale === "zh" ? ["zh"] : [];
    for (const slug of getAllDocSlugs(nav)) {
      params.push({ slug: [...prefix, ...slug.split("/")] });
    }
    for (const source of Array.from(loadDocsRedirects(locale).keys())) {
      params.push({ slug: [...prefix, ...source.split("/")] });
    }
  }

  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const locale = localeFromSlug(slug);
  const pageSlug = pageSlugFromRoute(slug);
  const doc = await loadMdxFile(pageSlug, locale);
  if (!doc) return {};

  const current = pageSlug.join("/");
  return {
    title: doc.frontmatter.title
      ? `${doc.frontmatter.title} | ${locale === "zh" ? "TNT 文档" : "TNT Docs"}`
      : locale === "zh"
        ? "TNT 文档"
        : "TNT Docs",
    description: doc.frontmatter.description || "",
    alternates: {
      canonical: docPath(locale, current),
      languages: {
        en: docPath("en", current),
        "zh-CN": docPath("zh", current),
      },
    },
  };
}

export default async function DocsPage({ params }: Props) {
  const { slug } = await params;
  const locale = localeFromSlug(slug);
  const slugPath = pageSlugFromRoute(slug);

  // Check redirect first
  const redirectTo = resolveDocsRedirect(slugPath, locale);
  if (redirectTo) {
    const target = redirectTo.startsWith("http")
      ? redirectTo
      : docPath(locale, redirectTo.replace(/^\//, "") || "index");
    return <ClientRedirect to={target} />;
  }

  const doc = await loadMdxFile(slugPath, locale);
  if (!doc) {
    return <NotFoundPage />;
  }

  const headings = getHeadings(doc.content);
  const docsNav = loadDocsNav(locale);
  const titleMap = getAllDocTitles(locale);

  const { content } = await compileMDX({
    source: doc.content,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: "wrap",
              properties: { className: ["heading-anchor"] },
            },
          ],
          [rehypePrismPlus, { ignoreMissing: true }],
        ],
      },
    },
    components: mdxComponents,
  });

  const currentSlug = slugPath.join("/");
  const { prev, next } = getPageNavigation(docsNav, currentSlug, titleMap);

  return (
    <DocsShell
      locale={locale}
      currentSlug={currentSlug}
      headings={headings}
      titleMap={titleMap}
      docsNav={docsNav}
    >
      {doc.frontmatter.title && (
        <div className="mb-2 flex items-start justify-between gap-4">
          <h1 className="text-3xl font-light tracking-tight text-black/90 dark:text-white/90">
            {doc.frontmatter.title}
          </h1>
          <CopyPageButton slug={currentSlug} locale={locale} />
        </div>
      )}
      {doc.frontmatter.description && (
        <p className="mb-8 text-lg text-black/50 dark:text-white/50">
          {doc.frontmatter.description.replace(/\*\*/g, "")}
        </p>
      )}
      <div className="docs-content max-w-3xl">{content}</div>
      <div className="max-w-3xl">
        <PageNav prev={prev} next={next} locale={locale} />
      </div>
    </DocsShell>
  );
}
