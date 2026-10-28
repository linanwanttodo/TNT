export const DEFAULT_PAGE_SIZE = 25;

/**
 * A cursor is the page and its size, encoded so a client can hand it back
 * unchanged. Nothing here reads the data behind the page - the caller turns a
 * cursor into a query.
 */
export function cursorFor(page: number, size: number): string {
  return `${Buffer.from(`${page}:${size}`).toString("base64url")}`;
}

export function pageFromCursor(cursor: string): { page: number; size: number } {
  const [page, size] = Buffer.from(cursor, "base64url").toString().split(":");
  return { page: Number(page), size: Number(size) };
}
