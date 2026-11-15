/**
 * Resolve internal paths for the standalone docs app.
 *
 * The docs site is served on its own, so /docs/X collapses to /X and every
 * other path stays inside this application.
 */
export function resolveHref(path: string): string {
  if (path.startsWith("/docs/")) return path.slice(5);
  if (path === "/docs") return "/";

  return path;
}
