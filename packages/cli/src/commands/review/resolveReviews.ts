import * as fs from "fs";
import * as path from "path";

export interface ResolvedReview {
  /** Display name for the review */
  name: string;
  /** Path to the review file */
  source: string;
  /** Every resolvable source is a local file */
  sourceType: "local";
}

/**
 * Determine which reviews to run, in one order:
 * 1. The paths or names given on the CLI, each of which has to be a readable file
 * 2. Local .tnt/agents/*.md and .tnt/checks/*.md
 *
 * There is no hub to fall back to: review resolution from the platform was removed,
 * so a name that is not a path cannot resolve to anything and is refused here rather
 * than carried into a worker that would try to read it as a file.
 */
export async function resolveReviews(
  agentFlags?: string[],
): Promise<ResolvedReview[]> {
  // Source 1: CLI --agent flags
  if (agentFlags && agentFlags.length > 0) {
    for (const agent of agentFlags) {
      if (!isLocalPath(agent)) {
        throw new Error(
          `hub review sources are not available: ${agent} is not a file path`,
        );
      }
    }
    return agentFlags.map((agent) => ({
      name: agentDisplayName(agent),
      source: agent,
      sourceType: "local" as const,
    }));
  }

  // Source 2: Local .tnt/agents/*.md and .tnt/checks/*.md
  const localReviews = resolveFromLocal();
  if (localReviews.length > 0) {
    return localReviews;
  }

  return [];
}

/**
 * Resolve reviews from local .tnt/agents/*.md and .tnt/checks/*.md files.
 * Agents take precedence over checks if the same filename exists in both directories.
 */
function resolveFromLocal(): ResolvedReview[] {
  const cwd = process.cwd();
  const dirs = [
    path.join(cwd, ".tnt", "agents"),
    path.join(cwd, ".tnt", "checks"),
  ];

  const seen = new Set<string>();
  const results: ResolvedReview[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        if (!seen.has(file)) {
          seen.add(file);
          results.push({
            name: path.basename(file, ".md").replace(/[-_]/g, " "),
            source: path.join(dir, file),
            sourceType: "local" as const,
          });
        }
      }
    } catch {
      // Directory read failed, skip
    }
  }

  return results;
}

export function isLocalPath(agent: string): boolean {
  return (
    agent.startsWith(".") ||
    agent.startsWith("/") ||
    agent.startsWith("~") ||
    agent.endsWith(".md") ||
    agent.endsWith(".yaml") ||
    agent.endsWith(".yml") ||
    // Windows absolute path (C:\...)
    /^[A-Za-z]:[/\\]/.test(agent)
  );
}

function agentDisplayName(agent: string): string {
  if (isLocalPath(agent)) {
    return path.basename(agent, path.extname(agent)).replace(/[-_]/g, " ");
  }
  // Hub slug: "org/agent-name" -> "agent-name" -> "agent name"
  const parts = agent.split("/");
  return (parts[parts.length - 1] || agent).replace(/[-_]/g, " ");
}
