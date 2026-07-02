import type { ChatHistoryItem } from "core/index.js";
import { createHistoryItem } from "core/util/messageConversion.js";

/**
 * A compact, deterministic reading of the user's message.
 *
 * The brief is extraction only: every line comes from text the user actually
 * wrote, selected by an explicit marker. It never adds a requirement, a path or
 * a command the message did not contain, because a fabricated constraint is
 * worse than no brief - the model would spend the turn satisfying something
 * nobody asked for.
 */
export interface UserBrief {
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly acceptance: readonly string[];
  readonly references: {
    readonly paths: readonly string[];
    readonly commands: readonly string[];
    readonly errors: readonly string[];
  };
  readonly language: string;
  /** The rendered compact form, without the request wrapper. */
  readonly text: string;
}

export interface UserBriefContext {
  /** False when `/brief off` (or the persisted setting) disables it. */
  readonly enabled?: boolean;
}

export interface UserBriefInsertion {
  /** History index the brief goes before; that item stays after it. */
  readonly at: number;
  readonly brief: UserBrief;
  readonly historyItem: ChatHistoryItem;
}

export const USER_BRIEF_OPEN = "<user-brief>";
export const USER_BRIEF_CLOSE = "</user-brief>";

const MAX_OBJECTIVE = 200;
const MAX_CLAUSE = 180;
const MAX_REFERENCES = 6;
const MAX_CONSTRAINTS = 5;
const MAX_ACCEPTANCE = 4;
const MAX_ERRORS = 3;
const MIN_MEANINGFUL_CHARS = 12;
const MIN_CJK_CHARS = 6;

const TRIVIAL_MESSAGE =
  /^(?:please\s+continue|keep going|go on|proceed|resume|continue|again|retry|yes|yep|y|ok|okay|sure|do it|thanks|thank you|hello|hi|hey|好|好的|可以|继续|接着|是的|对|嗯|谢谢|你好|没问题|再来|重试|开始)[\s.!?。！？]*$/i;

const CONSTRAINT_MARKER =
  /\b(?:must(?:\s+not)?|mustn't|should(?:\s+not)?|shouldn't|shall|do not|don't|never|only|without|avoid|ensure|make sure|keep|preserve|require[sd]?|needs?\s+to|no\s+(?:changes?|edits?|new\s+dependencies))\b|必须|务必|不得|禁止|不要|不能|不可以|只能|仅需|只需|无需|不用|保持|确保|需要/i;

const ACCEPTANCE_MARKER =
  /\b(?:tests?|test\s+suite|verify|verified|verifies|pass|passes|passing|lint|lints|build|builds|green|expect(?:ed|s)?|acceptance|repro(?:duce|duces|duction)?|regression|done\s+when)\b|测试|验收|验证|通过|构建|编译|复现|回归|预期/i;

const ERROR_MARKER =
  /\b(?:error|errors|exception|traceback|panic|failed|failure|assertionerror|typeerror|referenceerror|cannot\s+read|is\s+not\s+a\s+function|segmentation\s+fault)\b|报错|错误|异常|失败|崩溃|堆栈|栈溢出/i;

const PATH_PATTERN =
  /(?<![:\w/])(?:\.{1,2}\/|\/)?(?:[\w@.+-]+\/)+[\w@.+-]+(?:\.[A-Za-z0-9]+)?|(?<![:\w/])[\w@.+-]+\.(?:tsx?|jsx?|mjs|cjs|json|jsonc|mdx?|py|go|rs|java|kt|kts|rb|php|c|cc|cpp|hpp?|cs|swift|sh|bash|zsh|ya?ml|toml|ini|cfg|conf|html?|css|scss|sass|sql|proto|gradle|lock|txt)\b/gi;

const KNOWN_COMMAND =
  /\b(?:(?:npm|npx|pnpm|yarn|bun|deno|node|tsx|git|tsc|vitest|jest|pytest|python3?|pip3?|cargo|make|docker|docker-compose|kubectl|curl|wget|rg|grep)\s+[^\n。；;!?！？]+|go\s+(?:test|build|run|mod|vet|fmt)\b[^\n。；;!?！？]*)/gi;

const COMMAND_TRAILING_PROSE =
  /\s+(?:and|then|to|so|but|which|that|while|when|in|on|for|with|should|must|sure|验证|检查|确保|通过|然后|并|以|来|去|就|会|能)\b.*$|\s*(?:验证|检查|确保|通过|然后).*$/i;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

function splitClauses(input: string): string[] {
  return input
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+|(?<=[。！？；])/))
    .map(normalize)
    .filter((clause) => clause !== "");
}

function isErrorClause(clause: string): boolean {
  return ERROR_MARKER.test(clause);
}

/**
 * A leading stack-trace line is not the goal; it is the symptom. Only a line
 * that opens with the error itself is skipped for the objective, so `修复…报错`
 * still keeps its sentence.
 */
const LEADING_ERROR =
  /^(?:error|errors|exception|traceback|panic|failed|failure|(?:type|reference|assertion)error|cannot\s+read|uncaught)\b/i;

function isLeadingErrorClause(clause: string): boolean {
  return (
    LEADING_ERROR.test(clause) || /^(?:报错|错误|异常|失败)[:：]/.test(clause)
  );
}

function countCjk(text: string): number {
  return (text.match(/[㐀-鿿]/g) ?? []).length;
}

function meaningfulEnough(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < MIN_MEANINGFUL_CHARS) return false;
  const cjk = countCjk(text);
  if (cjk >= MIN_CJK_CHARS) return true;
  // A Latin message needs at least two words. One long token is a hash, an id
  // or pasted output, not a request worth briefing.
  return text.split(/\s+/).filter(Boolean).length >= 2;
}

function hasLetters(text: string): boolean {
  return /[A-Za-z㐀-鿿]/.test(text);
}

function detectLanguage(text: string): string {
  if (countCjk(text) >= 2) return "zh";
  return /[A-Za-z]/.test(text) ? "en" : "unknown";
}

function uniqueCapped(
  values: readonly string[],
  max: number,
  exclude: readonly string[] = [],
): string[] {
  const seen = new Set(exclude.map((value) => normalize(value)));
  const out: string[] = [];
  for (const value of values) {
    const trimmed = cap(normalize(value), MAX_CLAUSE);
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function extractPaths(text: string): string[] {
  const found = [...text.matchAll(PATH_PATTERN)]
    .map((match) => match[0].replace(/[.,;:!?。；：！？]+$/, ""))
    .filter((path) => path !== "");
  return uniqueCapped(found, MAX_REFERENCES).filter(
    (path) => !path.startsWith("http"),
  );
}

function commandCandidate(value: string): string | undefined {
  const trimmed = normalize(value)
    .replace(/^\$\s+/, "")
    .replace(/`/g, "")
    .replace(/[.,;:!?。；：！？]+$/, "");
  if (trimmed === "") return undefined;
  return cap(trimmed.replace(COMMAND_TRAILING_PROSE, "").trim(), MAX_CLAUSE);
}

function extractCommands(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(/`([^`\n]{1,200})`/g)) {
    const candidate = commandCandidate(match[1]);
    if (candidate) found.push(candidate);
  }
  for (const match of text.matchAll(/^\s*\$\s+(.+)$/gm)) {
    const candidate = commandCandidate(match[1]);
    if (candidate) found.push(candidate);
  }
  for (const match of text.matchAll(KNOWN_COMMAND)) {
    const candidate = commandCandidate(match[0]);
    if (candidate) found.push(candidate);
  }

  return uniqueCapped(found, MAX_REFERENCES);
}

function extractErrors(clauses: readonly string[]): string[] {
  return uniqueCapped(
    clauses.filter((clause) => isErrorClause(clause)),
    MAX_ERRORS,
  );
}

function render(brief: Omit<UserBrief, "text">): string {
  const lines: string[] = [`Objective: ${brief.objective}`];

  if (brief.constraints.length > 0) {
    lines.push("Constraints:");
    for (const constraint of brief.constraints) {
      lines.push(`- ${constraint}`);
    }
  }

  if (brief.acceptance.length > 0) {
    lines.push("Acceptance:");
    for (const signal of brief.acceptance) {
      lines.push(`- ${signal}`);
    }
  }

  const referenceLines: string[] = [];
  if (brief.references.paths.length > 0) {
    referenceLines.push(`- paths: ${brief.references.paths.join(", ")}`);
  }
  if (brief.references.commands.length > 0) {
    referenceLines.push(
      `- commands: ${brief.references.commands
        .map((command) => `\`${command}\``)
        .join(", ")}`,
    );
  }
  if (brief.references.errors.length > 0) {
    referenceLines.push(`- errors: ${brief.references.errors.join(" | ")}`);
  }
  if (referenceLines.length > 0) {
    lines.push("References:", ...referenceLines);
  }

  lines.push(`Language: ${brief.language}`);
  return lines.join("\n");
}

/**
 * Reads a message into a compact brief, or returns null when there is nothing
 * worth briefing: an empty or trivial continuation, a slash command, or a
 * message too short to carry a goal.
 */
export function buildUserBrief(
  text: string,
  context: UserBriefContext = {},
): UserBrief | null {
  if (context.enabled === false) return null;

  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("/")) return null;
  if (!hasLetters(trimmed)) return null;
  if (TRIVIAL_MESSAGE.test(trimmed)) return null;
  if (!meaningfulEnough(trimmed)) return null;

  const clauses = splitClauses(trimmed);
  const firstClause = clauses[0] ?? normalize(trimmed);
  const objectiveSource =
    isLeadingErrorClause(firstClause) && clauses.length > 1
      ? (clauses.find((clause) => !isLeadingErrorClause(clause)) ?? firstClause)
      : firstClause;

  const withoutObjective = clauses.filter(
    (clause) => clause !== objectiveSource,
  );
  // A clause can read as both ("should pass", "ensure the tests pass"). The
  // acceptance reading wins, because it says what will be checked rather than
  // what the implementation must look like.
  const acceptance = uniqueCapped(
    withoutObjective.filter((clause) => ACCEPTANCE_MARKER.test(clause)),
    MAX_ACCEPTANCE,
    [objectiveSource],
  );
  const constraints = uniqueCapped(
    withoutObjective.filter((clause) => CONSTRAINT_MARKER.test(clause)),
    MAX_CONSTRAINTS,
    [objectiveSource, ...acceptance],
  );

  const withoutText: Omit<UserBrief, "text"> = {
    objective: cap(normalize(objectiveSource), MAX_OBJECTIVE),
    constraints,
    acceptance,
    references: {
      paths: extractPaths(trimmed),
      commands: extractCommands(trimmed),
      errors: extractErrors(clauses),
    },
    language: detectLanguage(trimmed),
  };

  return { ...withoutText, text: render(withoutText) };
}

/** Wraps a brief as a user-role context message for the request. */
export function renderUserBriefMessage(brief: UserBrief): string {
  return `${USER_BRIEF_OPEN}\n${brief.text}\n${USER_BRIEF_CLOSE}`;
}

export function isUserBriefContent(content: string): boolean {
  return content.trimStart().startsWith(USER_BRIEF_OPEN);
}

function messageText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join(" ");
    return normalize(text) === "" ? undefined : text;
  }
  return undefined;
}

/** The newest user text, ignoring the brief this module inserted. */
export function findLastUserText(
  history: readonly ChatHistoryItem[],
): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    if (item.message.role !== "user") continue;
    const text = messageText(item.message.content);
    if (text === undefined || isUserBriefContent(text)) continue;
    return text;
  }
  return undefined;
}

/**
 * Plans the brief for the turn that just appended a user message.
 *
 * Only a history whose last item is a user message is a turn boundary. A
 * resumed session that ends on an assistant turn must not receive a brief for
 * an older message in the middle of the history.
 */
export function planUserBrief(
  history: readonly ChatHistoryItem[],
  context: UserBriefContext = {},
): UserBriefInsertion | null {
  if (context.enabled === false) return null;
  if (history.length === 0) return null;

  const last = history[history.length - 1];
  if (last.message.role !== "user") return null;

  const text = messageText(last.message.content);
  if (text === undefined || isUserBriefContent(text)) return null;

  const previous = history[history.length - 2];
  if (previous) {
    const previousText = messageText(previous.message.content);
    if (previousText !== undefined && isUserBriefContent(previousText)) {
      return null;
    }
  }

  const brief = buildUserBrief(text, context);
  if (!brief) return null;

  const content = renderUserBriefMessage(brief);
  const historyItem = createHistoryItem({ role: "user", content }, []);
  historyItem.userText = content;

  return { at: history.length - 1, brief, historyItem };
}

/**
 * The append-only placement: the brief lands immediately before the current
 * user message, so every byte of the earlier history keeps its position.
 */
export function withUserBrief(
  history: ChatHistoryItem[],
  context: UserBriefContext = {},
): {
  history: ChatHistoryItem[];
  brief?: UserBrief;
  item?: ChatHistoryItem;
} {
  const plan = planUserBrief(history, context);
  if (!plan) return { history };

  const next = [...history];
  next.splice(plan.at, 0, plan.historyItem);
  return { history: next, brief: plan.brief, item: plan.historyItem };
}
