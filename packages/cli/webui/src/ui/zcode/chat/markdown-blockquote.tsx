"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils.ts";

export type MarkdownBlockquoteProps = ComponentProps<"blockquote"> & {
  node?: unknown;
};

export function MarkdownBlockquote({
  className,
  node: _node,
  ...props
}: MarkdownBlockquoteProps) {
  return (
    <blockquote
      className={cn(
        "border-border text-foreground-subtle my-4 border-l-2 pl-3",
        "[&_p+p]:mt-2 [&_p]:my-0",
        className,
      )}
      data-markdown-blockquote=""
      {...props}
    />
  );
}
