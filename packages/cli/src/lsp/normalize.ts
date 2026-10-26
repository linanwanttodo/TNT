import type {
  LspCallHierarchy,
  LspCallSite,
  LspDocumentSymbol,
  LspLocation,
} from "./manager.js";

const MAX_OUTLINE_SYMBOLS = 200;
const MAX_OUTLINE_DEPTH = 6;

export function flattenDocumentSymbols(answer: unknown[]): LspDocumentSymbol[] {
  const outline: LspDocumentSymbol[] = [];
  const visit = (item: Record<string, any>, depth: number): void => {
    if (outline.length >= MAX_OUTLINE_SYMBOLS || depth > MAX_OUTLINE_DEPTH) {
      return;
    }
    const start =
      item.selectionRange?.start ??
      item.location?.range?.start ??
      item.range?.start;
    outline.push({
      name: String(item.name ?? "unnamed"),
      kind: typeof item.kind === "number" ? item.kind : undefined,
      depth,
      line: oneBased(start?.line),
      character: oneBased(start?.character),
    });
    if (Array.isArray(item.children)) {
      for (const child of item.children) {
        if (child && typeof child === "object") {
          visit(child, depth + 1);
        }
      }
    }
  };
  for (const item of answer) {
    if (item && typeof item === "object") {
      visit(item as Record<string, any>, 0);
    }
  }
  return outline;
}

export function normalizeLocations(answer: unknown): LspLocation[] {
  const items = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const locations: LspLocation[] = [];
  for (const item of items as Array<Record<string, any>>) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.targetUri === "string") {
      locations.push({
        uri: item.targetUri,
        range: item.targetSelectionRange ?? item.targetRange,
      });
    } else if (typeof item.uri === "string") {
      locations.push({ uri: item.uri, range: item.range });
    }
  }
  return locations;
}

function oneBased(value: unknown): number | undefined {
  return typeof value === "number" ? value + 1 : undefined;
}

export function normalizeCallHierarchy(
  item: Record<string, unknown>,
  answer: unknown,
  direction: "incoming" | "outgoing",
): LspCallHierarchy {
  const sites: LspCallSite[] = [];
  if (Array.isArray(answer)) {
    for (const call of answer as Array<Record<string, any>>) {
      if (direction === "incoming") {
        const from = call?.from ?? {};
        const range = Array.isArray(call?.fromRanges)
          ? call.fromRanges[0]?.start
          : undefined;
        sites.push({
          name: String(from.name ?? "unnamed"),
          uri: from.uri,
          line: oneBased(range?.line),
          character: oneBased(range?.character),
        });
      } else {
        const to = call?.to ?? {};
        const start = to.selectionRange?.start ?? to.range?.start;
        sites.push({
          name: String(to.name ?? "unnamed"),
          uri: to.uri,
          line: oneBased(start?.line),
          character: oneBased(start?.character),
        });
      }
    }
  }
  return {
    symbol: String(item.name ?? "symbol"),
    direction,
    sites,
  };
}
