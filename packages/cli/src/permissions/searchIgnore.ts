import { ToolPermissions } from "./types.js";

/**
 * The argument keys a file-scoped policy names its path by, and the tools
 * whose rules speak about files rather than commands. `Write(pattern)` in a
 * settings deny list becomes `{ file_path: "pattern" }` in a policy, and the
 * same glob is what a search should refuse to return.
 */
const PATH_ARGUMENT_KEYS = ["file_path", "filepath", "path"] as const;

const FILE_SCOPED_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "ApplyPatch",
]);

/**
 * The path globs the permission policies refuse, as ripgrep ignore globs. A
 * `deny` or `exclude` rule that names files ("Read(.env*)") already blocks the
 * read tool; without this, Search and the file listing would still print the
 * same paths as matches, which defeats the rule's point.
 *
 * Only a rule for a known file tool with a literal path glob contributes. A
 * tool-level `*` rule is a tool ban the policy layer already enforces, not a
 * path, and a command rule speaks about shell text. A leading `./` is stripped
 * because a ripgrep glob is relative to the search root already; anything
 * anchored outside it (`~/...`) matches nothing under the root and is passed
 * through as written, where it is harmless.
 */
export function policySearchIgnorePatterns(
  permissions: ToolPermissions,
): string[] {
  const patterns = new Set<string>();
  for (const policy of permissions.policies) {
    if (policy.permission !== "exclude") continue;
    if (!FILE_SCOPED_TOOLS.has(policy.tool)) continue;
    const matches = policy.argumentMatches;
    if (typeof matches !== "object" || matches === null) continue;
    for (const key of PATH_ARGUMENT_KEYS) {
      const value = (matches as Record<string, unknown>)[key];
      if (typeof value !== "string") continue;
      const glob = value.replace(/^\.\//, "");
      if (glob.trim() !== "") patterns.add(glob);
    }
  }
  return [...patterns];
}
