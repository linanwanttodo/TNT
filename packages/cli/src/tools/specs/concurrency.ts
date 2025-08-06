/**
 * Declares how a tool may be run relative to the other tool calls in the same
 * batch. Pure data: the planner reads this to group calls, and nothing here
 * imports the tool implementations.
 */

export type Concurrency =
  /** Safe to run alongside any number of other calls. */
  | "shared"
  /**
   * Mutually exclusive with every other exclusive call in the batch, and
   * additionally serialized against other calls that resolve to the same
   * keys. Exclusive calls never overlap each other regardless of keys.
   */
  | "exclusive"
  /**
   * Serialized per resolved key, so two edits to different files still run in
   * parallel. A call with no resolvable key is treated as exclusive.
   */
  | { readonly kind: "keyed"; readonly keysFrom: (args: any) => string[] };

export const MAX_PARALLEL_READS = 8;

/**
 * Slot name for work that cannot be attributed to a narrower shard. Held by
 * every exclusive call and by keyed calls whose arguments name no resource.
 */
export const GLOBAL_SLOT = " global";

/**
 * Commands whose effects are not confined to the working tree and so cannot be
 * reasoned about from the argument list alone. Matching is on the first token
 * of the command, plus a few subcommand forms that only become destructive
 * after their subcommand.
 */
const ALWAYS_EXCLUSIVE_COMMANDS = new Set([
  "apt",
  "apt-get",
  "brew",
  "bun",
  "cargo",
  "chmod",
  "chown",
  "composer",
  "curl",
  "docker",
  "gem",
  "git",
  "go",
  "gradle",
  "kubectl",
  "ln",
  "mv",
  "npm",
  "npx",
  "pacman",
  "pip",
  "pip3",
  "pnpm",
  "podman",
  "rm",
  "rsync",
  "sudo",
  "systemctl",
  "wget",
  "yarn",
]);

/** Subcommand forms that are only exclusive once the subcommand is present. */
const CONDITIONAL_EXCLUSIVE_SUBCOMMANDS = new Set([
  "dotnet",
  "gh",
  "hub",
  "mvn",
  "nix",
  "pnpm",
  "powershell",
  "pwsh",
]);

const WRITE_COMMAND_PATTERNS: RegExp[] = [
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bln\b/,
  /\bsed\b[^|]*\bi\b/,
  /\btee\b/,
  /\btruncate\b/,
  /\bdd\b[^|]*\bof=/,
  /\bpatch\b/,
  /\bgit\b/,
  // Output redirection writes a file just as surely as `tee` does. The leading
  // group keeps a comparison such as `a > b` in an arithmetic context from
  // being read as a redirect, and `>(` process substitution is left alone.
  /(^|[^0-9<>])>{1,2}(?![>])/,
];

function firstToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }
  // Take the first word of any segment, so `foo && git ...` still resolves.
  const segment = trimmed.split(/&&|\|\||;|\|/)[0].trim();
  const match = segment.match(/^[\w./-]+/);
  return match ? (match[0].split("/").pop() ?? "") : "";
}

function isMutatingCommand(command: string): boolean {
  if (!command.trim()) {
    return false;
  }

  const tokens = command.split(/\s+/);
  const head = firstToken(command);

  if (ALWAYS_EXCLUSIVE_COMMANDS.has(head)) {
    return true;
  }

  if (CONDITIONAL_EXCLUSIVE_SUBCOMMANDS.has(head)) {
    if (tokens.some((token) => token === "install" || token === "add")) {
      return true;
    }
  }

  // Compound commands are exclusive if any segment mutates state. A pipe is
  // excluded from the segment split above because `cat x | jq` is not a write,
  // but the pattern check below still sees the whole command.
  return WRITE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Resolved execution slots for one tool call. An exclusive call occupies the
 * global slot; a keyed call occupies one slot per key and also takes the
 * global slot when it cannot name a key.
 */
export interface ConcurrencyClaim {
  readonly exclusive: boolean;
  readonly keys: readonly string[];
}

export const TOOL_CONCURRENCY: Record<string, Concurrency> = {
  Read: "shared",
  Search: "shared",
  Grep: "shared",
  List: "shared",
  Fetch: "shared",
  Diff: "shared",
  Skills: "shared",
  Status: "shared",
  ReadLints: "shared",
  LS: "shared",

  Write: { kind: "keyed", keysFrom: (args) => pathKeys(args?.path) },
  Edit: { kind: "keyed", keysFrom: (args) => pathKeys(args?.path) },
  MultiEdit: { kind: "keyed", keysFrom: (args) => pathKeys(args?.path) },
  ApplyPatch: { kind: "keyed", keysFrom: (args) => pathKeys(args?.path) },
  Create: { kind: "keyed", keysFrom: (args) => pathKeys(args?.path) },

  Bash: {
    kind: "keyed",
    // A mutating command cannot be reasoned about from a path, so it falls
    // back to the global exclusive slot. A read-only command has no writes to
    // race with and stays shared.
    keysFrom: (args) =>
      isMutatingCommand(String(args?.command ?? "")) ? [] : ["shell:read"],
  },

  Subagent: "exclusive",
  Checklist: "exclusive",
  Exit: "exclusive",
  AskQuestion: "exclusive",
};

function pathKeys(rawPath: unknown): string[] {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return [];
  }
  return [normalizePathKey(rawPath)];
}

/**
 * Path keys are compared as normalized absolute-free strings so that
 * `./src/a.ts` and `src/a.ts` land on the same shard. Absolute paths are kept
 * distinct from relative ones because they may point outside the workspace.
 */
export function normalizePathKey(rawPath: string): string {
  const isAbsolute = rawPath.startsWith("/");
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (
      segment === ".." &&
      segments.length > 0 &&
      segments[segments.length - 1] !== ".."
    ) {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join("/");
  return isAbsolute ? `/${joined}` : joined;
}

export function claimForToolCall(
  toolName: string,
  args: unknown,
): ConcurrencyClaim {
  const spec = TOOL_CONCURRENCY[toolName];

  if (spec === undefined) {
    // Unknown tools include every MCP tool. MCP servers are frequently
    // stateful in ways this table cannot see, so they are treated as
    // exclusive rather than assumed safe.
    return { exclusive: true, keys: [] };
  }

  if (spec === "shared") {
    return { exclusive: false, keys: [] };
  }

  if (spec === "exclusive") {
    return { exclusive: true, keys: [] };
  }

  const keys = spec.keysFrom(args);
  return keys.length === 0
    ? { exclusive: true, keys: [] }
    : { exclusive: false, keys };
}
