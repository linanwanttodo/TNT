import type { ChatHistoryItem } from "core/index.js";

import { logger } from "../utils/logger.js";

/**
 * Auto mode: the permission prompt is replaced by a classifier decision. The
 * design follows the reference implementation's ordering - cheap deterministic
 * fast paths first, the model only for what is left, and every failure path
 * falling back to the human instead of silently approving.
 */

/**
 * Read-only and metadata tools whose arguments cannot point the call outside
 * what the base policy already answers for. Search is not here: its target
 * path can leave the workspace, so it goes through the acceptEdits check in
 * `resolveAutoModeDecision` - an in-workspace search is still allowed without
 * a classifier call, and one that leaves the workspace is classified.
 */
export const AUTO_SAFE_TOOLS = new Set([
  "Read",
  "List",
  "Glob",
  "FindSymbol",
  "References",
  "CallHierarchy",
  "Definition",
  "DocumentSymbol",
  "Hover",
  "ImportGraph",
  "Diagnostics",
  "CodebaseSearch",
  "Diff",
  "Status",
  "Checklist",
  "Completion",
  "CheckBackgroundJob",
  "AskQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "Exit",
  "ReportFailure",
  "Skills",
]);

/**
 * After this many refusals the human takes over again. The reference uses the
 * same numbers (3 consecutive, 20 total).
 */
export const AUTO_DENIAL_LIMITS = { consecutive: 3, total: 20 } as const;

export interface AutoDenialState {
  consecutive: number;
  total: number;
}

export function createAutoDenialState(): AutoDenialState {
  return { consecutive: 0, total: 0 };
}

export function recordAutoDenial(state: AutoDenialState): AutoDenialState {
  return {
    consecutive: state.consecutive + 1,
    total: state.total + 1,
  };
}

export function recordAutoSuccess(state: AutoDenialState): AutoDenialState {
  if (state.consecutive === 0) return state;
  return { ...state, consecutive: 0 };
}

export function shouldFallbackToPrompting(state: AutoDenialState): boolean {
  return (
    state.consecutive >= AUTO_DENIAL_LIMITS.consecutive ||
    state.total >= AUTO_DENIAL_LIMITS.total
  );
}

// Session-scoped bookkeeping: one auto-mode streak per process, reset when the
// mode changes so a fresh turn never inherits an old refusal count.
let sessionDenialState = createAutoDenialState();

export function resetAutoDenialState(): void {
  sessionDenialState = createAutoDenialState();
}

export function noteAutoDenial(): void {
  sessionDenialState = recordAutoDenial(sessionDenialState);
}

export function noteAutoSuccess(): void {
  sessionDenialState = recordAutoSuccess(sessionDenialState);
}

export function autoModeShouldPrompt(): boolean {
  return shouldFallbackToPrompting(sessionDenialState);
}

const TRANSCRIPT_ENTRIES = 8;
const TRANSCRIPT_CHARS = 600;
const ARGUMENT_CHARS = 1500;

const SYSTEM_PROMPT = `You are the auto-mode permission classifier for a coding agent.
Decide whether the proposed tool call may run without asking the user.
Allow routine, reversible development work the user's request implies:
reading or searching files inside the workspace, running builds, tests and
linters, editing files inside the workspace, git status/diff/log/add/commit,
and installing a dependency the user explicitly asked for.
Block actions that are destructive or exfiltrate data:
rm -rf on project or system paths, git reset --hard, git clean -f, force push,
branch or tag deletion, database drops, overwriting files outside the
workspace, reading or sending credentials such as ~/.ssh, .env files or tokens
to the network, piping downloads into a shell (curl | bash) unless the user
asked for it, sudo, global package installs, killing unrelated processes, and
disabling security tools.
When uncertain, block.
Answer with strict JSON only: {"allow": true, "reason": "<short reason>"} or
{"allow": false, "reason": "<short reason>"}.`;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "…";
}

function describeEntry(item: ChatHistoryItem): string | null {
  const message = item.message as any;
  if (!message) return null;

  if (message.role === "tool") {
    return `tool result: ${truncate(String(message.content ?? ""), TRANSCRIPT_CHARS)}`;
  }

  const parts: string[] = [];
  const content = typeof message.content === "string" ? message.content : "";
  if (content.trim()) parts.push(truncate(content, TRANSCRIPT_CHARS));
  for (const toolCall of message.toolCalls ?? []) {
    parts.push(
      `calls ${toolCall.function?.name}(${truncate(
        String(toolCall.function?.arguments ?? ""),
        ARGUMENT_CHARS,
      )})`,
    );
  }
  if (parts.length === 0) return null;
  return `${message.role}: ${parts.join(" | ")}`;
}

export interface AutoClassifierPromptInput {
  toolName: string;
  toolArgs: unknown;
  history: ChatHistoryItem[];
  /** How many transcript entries precede the action being judged. */
  actionIndex: number;
}

export function buildAutoClassifierMessages(input: AutoClassifierPromptInput): {
  system: string;
  user: string;
} {
  const recent = input.history
    .slice(
      Math.max(0, input.actionIndex - TRANSCRIPT_ENTRIES),
      input.actionIndex,
    )
    .map(describeEntry)
    .filter((entry): entry is string => Boolean(entry));

  const transcript =
    recent.length > 0 ? recent.join("\n") : "(no earlier turns)";
  const args = truncate(JSON.stringify(input.toolArgs ?? {}), ARGUMENT_CHARS);

  return {
    system: SYSTEM_PROMPT,
    user: `Recent transcript:\n${transcript}\n\nProposed action: ${input.toolName} ${args}`,
  };
}

export interface AutoClassifierContext extends AutoClassifierPromptInput {
  llmApi: any;
  model: any;
  signal: AbortSignal;
}

export interface AutoClassifierVerdict {
  outcome: "allow" | "block" | "unavailable";
  reason: string;
}

function parseVerdict(content: string): AutoClassifierVerdict | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      allow?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.allow !== "boolean") return null;
    return {
      outcome: parsed.allow ? "allow" : "block",
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : parsed.allow
            ? "Auto mode allowed this action."
            : "Auto mode blocked this action.",
    };
  } catch {
    return null;
  }
}

export async function classifyAutoAction(
  context: AutoClassifierContext,
): Promise<AutoClassifierVerdict> {
  try {
    const { system, user } = buildAutoClassifierMessages(context);
    const response = await context.llmApi.chatCompletionNonStream(
      {
        model: context.model.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 200,
        stream: false,
      },
      context.signal,
    );

    const content = response?.choices?.[0]?.message?.content;
    const verdict = typeof content === "string" ? parseVerdict(content) : null;
    if (!verdict) {
      logger.warn("Auto mode classifier returned no usable verdict");
      return {
        outcome: "unavailable",
        reason: "The auto mode classifier returned no usable verdict.",
      };
    }
    return verdict;
  } catch (error) {
    logger.warn("Auto mode classifier failed", { error });
    return {
      outcome: "unavailable",
      reason: "The auto mode classifier is unavailable.",
    };
  }
}
