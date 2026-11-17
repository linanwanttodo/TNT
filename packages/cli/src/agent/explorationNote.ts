import { isLargeWorkspace, localRepoMap } from "./repoMap.js";

/**
 * One note per session, leading the first prompt. Exploration is where a large
 * repository burns the main model's window: a dozen greps and files opened to
 * rule out dead ends. Delegating that work keeps the raw output in the child's
 * window; the map below removes the need to rediscover the tree each turn.
 * Both come from local files, never a remote code index.
 */

const injectedScopes = new Set<string>();

let largeWorkspace: { root: string; value: boolean } | undefined;

function isLarge(root: string): boolean {
  if (largeWorkspace?.root === root) {
    return largeWorkspace.value;
  }
  const value = isLargeWorkspace(root);
  largeWorkspace = { root, value };
  return value;
}

/** Test seam: a resumed session in the same process starts fresh. */
export function forgetExplorationNote(): void {
  injectedScopes.clear();
  largeWorkspace = undefined;
}

/** The CLI serves one workspace per process; a resumed session starts a process. */
function noteScope(): string {
  return process.cwd();
}

export function peekExplorationNote(): string | undefined {
  if (injectedScopes.has(noteScope())) {
    return undefined;
  }
  const root = process.cwd();
  if (!isLarge(root)) {
    return undefined;
  }
  const { map } = localRepoMap(root);
  return [
    "Exploration context (local only, shown once per session):",
    'For questions about where code lives, how it fits together, or which files are involved, delegate first to the read-only explore subagent. It keeps raw search output in its own window and returns only an evidence-backed map; read that map here, not a pile of grep results. A cheaper model is used when one is configured with roles: ["search"].',
    "Local repository map:",
    map,
  ].join("\n");
}

/** One take per session: later prompts carry no extra map bytes. */
export function takeExplorationNote(): string | undefined {
  const note = peekExplorationNote();
  if (note === undefined) {
    return undefined;
  }
  injectedScopes.add(noteScope());
  return note;
}
