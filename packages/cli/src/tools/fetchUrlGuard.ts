/**
 * What the Fetch tool will not read.
 *
 * The tool takes a URL from the model, and the model takes it from whatever it
 * was reading - so a page can name a URL the user never chose. Three kinds are
 * refused outright: a scheme that is not HTTP, and the link-local addresses that
 * cloud metadata services answer on (`169.254.0.0/16`, `fe80::/10`), where a
 * single GET can hand back credentials that have nothing to do with the question.
 *
 * Loopback and the private ranges stay allowed on purpose: this CLI runs on the
 * user's own machine, and reading a page from a dev server or an internal wiki is
 * ordinary work. The boundary is stated here rather than enforced by resolving
 * every hostname, because a DNS round trip per fetch buys a narrow case and this
 * comment is the honest description of what is covered.
 */
export function urlRefusal(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `Fetch needs an absolute URL; "${raw}" is not one.`;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Fetch reads http and https URLs only; "${raw}" is ${url.protocol.replace(
      ":",
      "",
    )}.`;
  }

  const host = url.hostname.toLowerCase();
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;

  if (isMetadataHost(bare)) {
    return `Fetch will not read ${url.hostname}: cloud metadata addresses answer on the link-local range and are not documentation.`;
  }

  return undefined;
}

function isMetadataHost(host: string): boolean {
  if (
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "instance-data"
  ) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    // 169.254.0.0/16, the range the metadata services live on.
    return v4[1] === "169" && v4[2] === "254";
  }
  // fe80::/10 in every spelling that starts with the segment.
  return /^fe[89ab][0-9a-f]:/.test(host);
}

/**
 * A fetch wrapper that refuses every URL the guard refuses and follows
 * redirects itself, so a 30x to a metadata address cannot slip past the check
 * on the initial URL. favicon extraction and any secondary request go through
 * this too, not only the page the model asked for.
 */
export function createGuardedFetch(inner: typeof fetch = fetch): typeof fetch {
  const MAX_REDIRECTS = 5;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    let requestInit = init;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const refusal = urlRefusal(target);
      if (refusal) throw new Error(refusal);
      const response = await inner(target, {
        ...requestInit,
        redirect: "manual",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return response;
        await response.body?.cancel();
        const next = new URL(location, target);
        if (next.origin !== new URL(target).origin) {
          const headers = new Headers(requestInit?.headers);
          headers.delete("authorization");
          headers.delete("proxy-authorization");
          headers.delete("cookie");
          requestInit = { ...requestInit, headers };
        }
        target = next.toString();
        continue;
      }
      return response;
    }
    throw new Error("Fetch refused: too many redirects");
  }) as typeof fetch;
}
