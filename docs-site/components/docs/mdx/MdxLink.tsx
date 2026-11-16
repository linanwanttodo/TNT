import { withBasePath } from "@/lib/basePath";
import { resolveHref } from "@/lib/resolveHref";

export function MdxLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href?.startsWith("/")) {
    const internalPath = href.startsWith("/docs") ? href : `/docs${href}`;
    // A plain <a> does not get Next's automatic basePath, so a project site
    // under /<repo> must prefix it explicitly or every in-page link 404s.
    href = withBasePath(resolveHref(internalPath));
  }

  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
