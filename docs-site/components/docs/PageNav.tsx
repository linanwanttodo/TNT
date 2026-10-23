"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { docPath, type Locale } from "@/lib/i18n";

export function PageNav({
  prev,
  next,
  locale,
}: {
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  locale: Locale;
}) {
  if (!prev && !next) return null;

  return (
    <div className="mt-16 flex items-center justify-between border-t border-black/[0.06] pt-6 dark:border-white/[0.06]">
      {prev ? (
        <Link
          href={docPath(locale, prev.slug)}
          className="flex items-center gap-2 text-sm text-black/40 no-underline transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>{prev.title}</span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={docPath(locale, next.slug)}
          className="flex items-center gap-2 text-sm text-black/40 no-underline transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
        >
          <span>{next.title}</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}
