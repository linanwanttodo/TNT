import * as path from "path";

/**
 * Extensions a planning session is allowed to write. Deliberately narrow: an
 * extension that is not listed here is refused rather than treated as prose.
 */
export const DOCUMENT_EXTENSIONS = [".md", ".mdx", ".markdown", ".rst", ".txt"];

/**
 * True when the path names a documentation file. The judgement is made on the
 * extension alone so a plan can sit next to the code it describes, and so an
 * unfamiliar extension is refused instead of assumed harmless.
 */
export function isDocumentPath(filePath: unknown): boolean {
  if (typeof filePath !== "string") {
    return false;
  }

  const extension = path.extname(filePath.trim()).toLowerCase();

  return extension !== "" && DOCUMENT_EXTENSIONS.includes(extension);
}
