/* eslint-disable max-lines -- the system message assembles every prompt layer in one place so ordering is reviewable */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { env } from "../config/env.js";
import { processRule } from "../config/hubLoader.js";
import type { OutputFormat } from "../config/outputFormat.js";
import {
  readSettingsBoolean,
  readSettingsString,
} from "../config/settingsFiles.js";
import { t } from "../i18n/index.js";
import { PermissionMode } from "../permissions/types.js";
import {
  loadAllPlugins,
  selectForcedOutputStyle,
  type PluginOutputStyle,
} from "../plugins/loader.js";
import {
  getSessionActiveTeam,
  getSessionGoal,
  getSessionOutputStyle,
} from "../session/index.js";
import { getTeam } from "../team/loader.js";
import { logger } from "../utils/logger.js";
import { isMemoryEnabled } from "../utils/memoryState.js";

import { loadInstructionFile } from "./instructionIncludes.js";
import {
  getConfigYamlRules,
  loadMarkdownRulesWithMetadata,
} from "./markdownRules.js";
import { loadProjectDocs } from "./projectDocs.js";
import {
  PLAN_MODE_TEXT,
  profileSection,
  type PromptProfile,
} from "./promptProfiles.js";
import {
  createSectionRegistry,
  joinSystemMessageSections,
  type SectionKind,
} from "./systemMessageSections.js";

// Static, because everything ahead of the user's own text is inside the cached
// prefix of every request in the session.
export const RULES_PREAMBLE =
  "These instructions come from the user's own files for this project and override how you would otherwise choose to work. Follow each one. They are listed from the project root to the working directory; where two of them conflict, the one closer to the project and to the file being changed wins, and AGENTS.override.md wins over the other instruction files in its directory. Say which you followed when the choice mattered. When a request cannot be met under them, say so instead of quietly dropping the rule.";

/**
 * Check if current directory is a git repository. Memoized per process: the
 * answer cannot change while the CLI runs, and re-running it per round would
 * cost one subprocess per round on the prefix's critical path.
 */
function isGitRepo(): boolean {
  if (gitRepoChecked === undefined) {
    try {
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        stdio: "ignore",
      });
      gitRepoChecked = true;
    } catch {
      gitRepoChecked = false;
    }
  }
  return gitRepoChecked;
}
let gitRepoChecked: boolean | undefined;

// A large tree can be thousands of entries, and this block rides along with
// every request in the session, so it is bounded and says what it dropped.
const GIT_STATUS_MAX_ENTRIES = 200;
const GIT_STATUS_MAX_CHARS = 8000;

export function formatGitStatus(raw: string): string {
  const entries = raw.split("\n").filter((line) => line.trim() !== "");
  if (entries.length === 0) return "Working tree clean";

  const kept: string[] = [];
  let chars = 0;
  for (const entry of entries) {
    if (kept.length >= GIT_STATUS_MAX_ENTRIES) break;
    if (chars + entry.length > GIT_STATUS_MAX_CHARS) break;
    kept.push(entry);
    chars += entry.length + 1;
  }

  const dropped = entries.length - kept.length;
  if (dropped === 0) return kept.join("\n");

  return `${kept.join(
    "\n",
  )}\n\n[${dropped.toLocaleString()} of ${entries.length.toLocaleString()} entries are not shown: the list stops at ${GIT_STATUS_MAX_ENTRIES.toLocaleString()} entries or ${GIT_STATUS_MAX_CHARS.toLocaleString()} characters. Run git status for the whole picture.]`;
}

/**
 * Get git status. Cached per process: the block's own wording promises the
 * model a snapshot from the start of the conversation, and re-running the
 * subprocess per round would both betray that promise and move the cached
 * prefix whenever the user touches a file mid-session.
 */
function getGitStatus(): string {
  if (gitStatusSnapshot === undefined) {
    try {
      if (isGitRepo()) {
        const result = execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf-8",
          cwd: process.cwd(),
        });
        gitStatusSnapshot = formatGitStatus(result);
      } else {
        gitStatusSnapshot = "Not a git repository";
      }
    } catch {
      gitStatusSnapshot = "Git status not available";
    }
  }
  return gitStatusSnapshot;
}
let gitStatusSnapshot: string | undefined;

const baseSystemMessage = `You are an agent in TNT. Given the user's prompt, you should use the tools available to you to answer the user's question.

Notes:
1. IMPORTANT: You should be concise, direct, and to the point, since your responses will be displayed on a command line interface.
2. When relevant, share file names and code snippets relevant to the query
3. Keep answers plain text. Emoji are allowed in prose, but never as decoration: no emoji bullets, no emoji headings, and no emoji labels on comparisons or on notes you consider important. Write the word instead.

# Doing tasks
1. Look before you claim. When a file, function or module is named that you have not seen, search for it and read it rather than describing what you expect to be there. Saying "I have not looked" is recoverable; a guess about code you never read is not.
2. Do not propose a change to code you have not read in this session. Read is cheap and refuses nothing.
3. Do the task that was asked for. No features nobody requested, no tidying of code you were not changing, no comments or type annotations on lines you did not touch. Three similar lines is better than an abstraction nobody asked for.
4. Default to writing no comments. When the reason behind a line is not visible in the line itself, one short line saying why is enough.
5. Verify before you report. Run the test, run the build, run the command and read its output. When you could not run it, say you did not - and never state that a suite passed when you did not watch it pass.
6. Judge reversibility before acting. Asking costs a moment; an unwanted action can cost work that cannot be recovered. An approval given once is not a standing approval, and an approval for one change does not cover the next.
7. When you have enough information to act, act. Do not re-derive what this conversation already established, re-open a decision the user has made, or list options you are not taking. A choice that is still open gets a recommendation, not a survey.
8. The requested scope is the deliverable. Do not quietly narrow it, widen it or turn it into a different task. If part of the work is blocked, finish everything else and say exactly what you left out and why.
9. A call the user denied was declined, not misheard: change the attempt instead of repeating it unchanged. Independent tool calls can be sent together in one response.
10. Before deleting or overwriting, look at the target. Content sent to an external service is published - it can be cached or indexed after deletion - so an action that leaves this machine is confirmed first unless the user authorized that one.
11. When you raise a concern and the user repeats the request, that is their decision: proceed with the whole request.
12. Before you end a turn, read your own last paragraph. If it is a plan, a question you could answer yourself, or a promise about work not yet done, do that work now instead.
13. When a failure pattern-matches something familiar, check that the evidence supports this specific action before changing anything; the cause may be somewhere else.
14. Work inside the patterns and helpers the repository already has. A new abstraction has to remove real complexity, not just give code a shape.
15. Scale the checking to the blast radius: a narrow change needs a narrow test, and once shared behaviour moves, run the broad suite.
16. Never undo a change you did not make. Work with it, or say when it makes the task impossible.
17. Use the plan tools for work that needs several dependent steps. A request that is already one edit, one command or one lookup does not get a plan.

# Escalation
Some actions need the user's decision every time, even when the surrounding task is approved:
- a destructive command the request did not name: rewriting history, a forced clean, or deleting and overwriting files outside the task;
- a write that lands outside the workspace;
- sending content outside this machine when the user did not approve that content leaving;
- launching a GUI application or opening a window on the user's desktop.
Ask with what the action changes and why the request needs it. Size is not the trigger: a large edit inside the workspace that can be reverted is the task, not an escalation.

# Communication style
1. Lead with the answer or the outcome. When something could not be verified, say that first.
2. Write for someone who stepped away and is coming back: what changed, the evidence for it, and what is still open - not the order things were tried in.
3. One idea per sentence, with a verb. No em dashes, no arrows, no parenthetical asides.
4. Keep code and numbers out of prose; name a file or flag only when the reader has to go there, and put commands and their output in a fenced block.
5. Reference a location as path:line.
6. Stop when the content stops: no closing offer, and no restating what the user can already see.
7. Do not narrate your own reasoning, and do not announce that a task needed no tools.

When you find an unrelated bug or issue while working, report it: the final report gets a short section naming its location and one sentence on its impact. Do not fix it, and do not expand on it. A problem on the shared path of this task is different - fix it or flag it.
`;

/**
 * The auto-memory clause. TNT keeps a memory file per project and per machine;
 * the model appends to it on its own when something is worth carrying across
 * sessions. Selective by design: only what changes how the next session works,
 * never a running commentary, so the file stays small enough to always load.
 */
const memoryClause = `

# Memory
A memory file lives at .tnt/TNT.md in this project, and a machine-wide one at
~/.tnt/TNT.md. Their contents are loaded into your context at the start of every
session. When a turn teaches you something that will matter next time - a build
or test command that failed in a non-obvious way, a preference the user states
about how they want work done, a convention the repository follows that the code
does not make obvious, a tool or file location you had to search for - append
ONE short line about it to the project memory file with the file write tool,
creating the file with a "# TNT Memory" heading if it does not exist.

Be selective: a note earns its place only if it would save the next session real
time or prevent repeating a mistake. Never record what the code or git history
already shows, the steps of a routine task, or anything from this conversation
that will not matter again. Do not rewrite or reorganize existing notes; append
only. The .tnt directory is kept out of version control through .gitignore:
never stage anything in it, never remove that ignore rule.`;

/**
 * The machine-shaped half of the prompt: where the CLI was started, what the
 * working tree looked like when it started, and today's date.
 *
 * This used to be welded to the head of `base`, so the entire billed prefix moved
 * at midnight and again whenever an uncommitted file appeared or went away - the
 * one thing the cached prefix is supposed to survive. It is its own volatile
 * section now, and it is appended last, so it moves the tail only.
 */
/**
 * The session's start date, frozen for the process. The environment section is
 * part of the volatile tail, but a midnight rollover would still rewrite it
 * mid-session and rebill the tail every round of a long-running CLI, so the
 * date is the day the session started, which is also the honest one.
 */
function sessionDate(): string {
  if (sessionStartDate === undefined) {
    sessionStartDate = new Date().toISOString().split("T")[0];
  }
  return sessionStartDate;
}
let sessionStartDate: string | undefined;

export function environmentSection(): string {
  return `
Here is useful information about the environment you are running in:
<env>
Working directory: ${process.cwd()}
Is directory a git repo: ${isGitRepo()}
Platform: ${process.platform}
Today's date: ${sessionDate()}
</env>

As you answer the user's questions, you can use the following context:

<context name="gitStatus">This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.

${getGitStatus()}
</context>`;
}

export {
  getConfigYamlRules,
  loadMarkdownRulesWithMetadata,
  managedRulesDir,
} from "./markdownRules.js";

/**
 * Renders an output style as its own system message section. Returns an empty
 * string when no style is active, so the caller can append unconditionally.
 */
/**
 * Precedence: the session choice, then a project default from the settings
 * files, then a style a plugin forces on. A named style whose plugin
 * disappeared falls through to the next source rather than throwing, since a
 * removed plugin should not break every request.
 */
function selectOutputStyle(
  styles: readonly PluginOutputStyle[],
): PluginOutputStyle | undefined {
  for (const candidate of [
    { name: getSessionOutputStyle(), source: "session" },
    { name: readSettingsString("outputStyle"), source: "settings" },
  ]) {
    if (!candidate.name) continue;
    const match = styles.find((style) => style.name === candidate.name);
    if (match) return match;
    logger.warn(
      `Output style ${candidate.name} from ${candidate.source} is not installed; trying the next source`,
    );
  }
  return selectForcedOutputStyle(styles);
}

export function buildOutputStyleSection(
  style: PluginOutputStyle | undefined,
): string {
  if (!style) return "";

  return `\n\n<context name="outputStyle" source="${style.name}">\n${style.prompt}\n</context>`;
}

/**
 * Load and construct a comprehensive system message with base message and rules section
 * @param additionalRules - Additional rules from --rule flags
 * @param format - Output format for headless mode
 * @param headless - Whether running in headless mode
 * @param mode - Current permission mode
 * @returns The comprehensive system message with base message and rules section
 */
export interface SystemMessageSection {
  readonly name: string;
  readonly text: string;
  /**
   * Whether this part is expected to change while a session runs - the permission
   * mode, an output style, the rule files a user edits. A volatile part moving is
   * the user's own change; a stable part moving means the CLI rewrote its own
   * prompt, which is the kind of thing worth a warning.
   */
  readonly volatile: boolean;
}

/**
 * One independently changeable piece of the rules block. The id is the identity
 * the reinjection planner tracks across rounds, so editing one rule file only
 * restates that file's bytes instead of the whole rules block.
 */
export interface RuleSource {
  readonly id: string;
  readonly text: string;
}

/**
 * The memory file TNT keeps itself, global first then the project's, so a
 * lesson learned in one project can apply everywhere without overriding a
 * project-specific decision. Both sit beside the settings they belong to.
 */
function memoryLayers(): RuleSource[] {
  const layers: RuleSource[] = [];
  if (!isMemoryEnabled()) {
    return layers;
  }
  const globalMemory = path.join(env.continueHome, "TNT.md");
  if (fs.existsSync(globalMemory)) {
    layers.push({
      id: "userRules:memory:global",
      text: `Global memory from TNT.md:\n${loadInstructionFile(globalMemory)}`,
    });
  }
  const projectMemory = path.join(process.cwd(), ".tnt", "TNT.md");
  if (fs.existsSync(projectMemory)) {
    layers.push({
      id: "userRules:memory:project",
      text: `Project memory from TNT.md:\n${loadInstructionFile(projectMemory)}`,
    });
  }
  return layers;
}

/**
 * Renders the prefix as named parts. The parts are joined in the order they are
 * built, so a cached prefix only moves when a part actually changes.
 */
/**
 * The receptionist discipline for the active team as its own context block, or
 * nothing. The main agent is the user's proxy arm while a team is active: it
 * takes the goal in, forwards it to the PM, dispatches per the PM's written
 * plan, reports back and escalates. It does not plan and does not wear the
 * lead's hat - the lead prompt flows to the team subagent through the dispatch
 * chain instead. Activation is a session decision and must not re-bill the
 * static spine, so the block rides the volatile userRules channel.
 */
function activeTeamLeadBlock(): string | undefined {
  const activeTeamName = getSessionActiveTeam();
  const activeTeam = activeTeamName
    ? getTeam(activeTeamName, process.cwd())
    : undefined;
  if (!activeTeam) return undefined;

  return `<context name="team-reception" source="${activeTeam.name}">\n${t(
    "agent.receptionistDiscipline",
    { team: activeTeam.name },
  )}\n</context>`;
}

/**
 * The session goal as its own context block, or nothing. The goal is generic
 * session state (it applies with or without a team), so it rides the same
 * volatile userRules channel as the team block: setting, changing or clearing
 * it re-renders only that section and never moves the cached spine.
 */
function goalAlignmentBlock(): string | undefined {
  const goal = getSessionGoal();
  if (!goal) return undefined;

  return `<context name="goal-align">\n${t("agent.goalAlignmentLine", {
    goal: goal.trim(),
  })}\n</context>`;
}

/**
 * The auto-convoke instruction as its own context block, or nothing. The
 * `team.autoConvoke` switch declares that a goal carrying the convoke signals
 * (multi-part work, multi-role collaboration, an explicit team callout) may
 * start the flow without the user naming a team; when it is off or unset the
 * block is absent, so the main agent never convenes a team on its own. The
 * switch is a settings-file decision, so the block rides the same volatile
 * userRules channel and flips on the next turn without moving the spine.
 */
function autoConvokeBlock(): string | undefined {
  if (readSettingsBoolean("team.autoConvoke") !== true) return undefined;

  return `<context name="team-convoke">\n${t("agent.autoConvoke")}\n</context>`;
}

/**
 * The rule material the userRules section carries, kept as separate sources:
 * the memory/agent-file layers, then every processed rule in order. Keeping
 * them apart is what lets one edited file restate only its own bytes.
 */
async function collectRuleMaterial(
  additionalRules?: string[],
): Promise<RuleSource[]> {
  const sources: RuleSource[] = [...memoryLayers()];

  try {
    // Root to working directory, one file per directory: the override wins,
    // then the names this CLI has always read.
    for (const doc of loadProjectDocs(process.cwd())) {
      sources.push({ id: `userRules:agent:${doc.label}`, text: doc.text });
    }

    // The CLI does not go through core's config loader, so the workspace's
    // `.tntrules` dotfile is read here, once, at the same level as the other
    // project rules.
    const tntRulesPath = path.join(process.cwd(), ".tntrules");
    if (fs.existsSync(tntRulesPath)) {
      sources.push({
        id: "userRules:tntrules",
        text: `Rules from .tntrules:\n${loadInstructionFile(tntRulesPath)}`,
      });
    }

    const localPath = path.join(process.cwd(), "AGENTS.local.md");
    if (fs.existsSync(localPath)) {
      sources.push({
        id: "userRules:agent-local",
        text: `Rules from AGENTS.local.md, which is not committed:\n${loadInstructionFile(localPath)}`,
      });
    }
  } catch (error) {
    // If there's any error reading a file, continue without agent content
    console.warn(t("common.agentConfigReadFailed"), error);
  }

  // Process additional rules from --rule flags
  if (additionalRules && additionalRules.length > 0) {
    for (let index = 0; index < additionalRules.length; index++) {
      try {
        const processedRule = await processRule(additionalRules[index]);
        sources.push({ id: `userRules:cli:${index}`, text: processedRule });
      } catch (error: any) {
        console.warn(
          t("common.ruleProcessFailed", {
            rule: additionalRules[index],
            message: error.message,
          }),
        );
      }
    }
  }

  const processedRules = sources
    .filter((source) => source.id.startsWith("userRules:cli:"))
    .map((source) => source.text);
  const configYamlRules = await getConfigYamlRules();
  configYamlRules.forEach((rule, index) => {
    if (rule) {
      sources.push({ id: `userRules:config:${index}`, text: rule });
      processedRules.push(rule);
    }
  });

  // Load markdown rules from .tnt/rules/ directories
  const markdownRules = loadMarkdownRulesWithMetadata();
  // Deduplicate against already-loaded rules
  const existingRulesSet = new Set(processedRules);
  const seenIds = new Set(sources.map((source) => source.id));
  markdownRules.forEach((rule, index) => {
    if (existingRulesSet.has(rule.rule)) return;
    existingRulesSet.add(rule.rule);
    const relative = rule.sourceFile
      ? path.relative(process.cwd(), rule.sourceFile)
      : "";
    let id = `userRules:rule:${relative || rule.name || index}`;
    // Two sources must never share an id: the planner would treat them as one
    // and restate neither. Fall back to the position when the path repeats.
    if (seenIds.has(id)) id = `${id}#${index}`;
    seenIds.add(id);
    sources.push({ id, text: rule.rule });
  });

  return sources.filter((source) => source.text !== "");
}

/**
 * The prefix is the concatenation of its sections, each of which already carries
 * the blank lines that separate it, so joining adds nothing.
 */

/** What one section build needs: the request shape plus the rule material. */
interface SectionBuildContext {
  readonly mode: PermissionMode;
  readonly format?: OutputFormat;
  readonly headless?: boolean;
  readonly profile?: PromptProfile;
  readonly ruleSources: readonly RuleSource[];
}

interface SectionDefinition {
  /** The section name as every consumer and the marker table know it. */
  readonly id: string;
  readonly kind: SectionKind;
  /**
   * Null when the section does not apply to this request shape. A definition
   * may emit several sections: the rules block is one announced part of the
   * prefix but many independently changeable sources inside it.
   */
  build(
    ctx: SectionBuildContext,
  ): SystemMessageSection | SystemMessageSection[] | null;
}

/**
 * The frozen registry, exported for the drift guards: a test that builds the
 * prefix can check every emitted section against the definition that owns it.
 */
export const SECTION_REGISTRY = createSectionRegistry<SectionDefinition>([
  {
    id: "base",
    kind: "stable",
    build: () => ({
      name: "base",
      text: `${baseSystemMessage}${memoryClause}`,
      volatile: false,
    }),
  },
  {
    // Plan is one text, whichever way it was chosen: the permission mode and
    // the profile must not produce two wordings of the same instruction.
    id: "planMode",
    kind: "diffable",
    build: (ctx) =>
      ctx.mode === "plan"
        ? { name: "planMode", text: PLAN_MODE_TEXT, volatile: true }
        : null,
  },
  {
    // The profile is the task-shaped axis. It is skipped when the plan text is
    // already in from the mode, and the default profile adds nothing at all.
    id: "promptProfile",
    kind: "diffable",
    build: (ctx) =>
      ctx.profile && ctx.profile !== "default" && ctx.mode !== "plan"
        ? {
            name: "promptProfile",
            text: profileSection(ctx.profile),
            volatile: true,
          }
        : null,
  },
  {
    // In headless mode, add instructions to be concise and only provide final answers
    id: "headless",
    kind: "stable",
    build: (ctx) =>
      ctx.headless
        ? {
            name: "headless",
            text: `

IMPORTANT: You are running in headless mode. Provide ONLY your final answer to the user's question. Do not include explanations, reasoning, or additional commentary unless specifically requested. Be direct and concise.

Nobody is watching in real time and no question can be answered mid-task, so asking one blocks the work: for reversible steps that follow from the request, proceed; stop only for destructive actions or a genuine change of scope. Offer follow-ups after the work is done; asking permission before starting it is not the way.`,
            volatile: false,
          }
        : null,
  },
  {
    // Add JSON formatting instructions if format is json
    id: "jsonOutput",
    kind: "stable",
    build: (ctx) =>
      ctx.format === "json"
        ? {
            name: "jsonOutput",
            text: `

IMPORTANT: You are operating in JSON output mode. Your final response MUST be valid JSON that can be parsed by JSON.parse(). The JSON should contain properties relevant to answer the user's question. You don't need to include any general "response" or "answer" field. Do not include any text before or after the JSON - the entire response must be parseable JSON.

Example response format:
{
  "property": "value"
}`,
            volatile: false,
          }
        : null,
  },
  {
    // A plugin may force an output style on as soon as it is enabled. Styles a
    // plugin merely offers are left alone: applying one changes every request
    // prefix until it is switched back, so it stays a user decision.
    id: "outputStyle",
    kind: "diffable",
    build: () => {
      const outputStyleSection = buildOutputStyleSection(
        selectOutputStyle(loadAllPlugins().outputStyles),
      );
      return outputStyleSection
        ? { name: "outputStyle", text: outputStyleSection, volatile: true }
        : null;
    },
  },
  {
    // The rules block is the last thing in the prefix, so its own wording stays
    // fixed and only the user's text changes. Each source inside it is its own
    // section: the wrapper and the preamble never move, and an edited rule
    // restates only the rule that changed instead of the whole block.
    id: "userRules",
    kind: "diffable",
    build: (ctx) => {
      const teamLeadBlock = activeTeamLeadBlock();
      const goalBlock = goalAlignmentBlock();
      const convokeBlock = autoConvokeBlock();

      const trailing: RuleSource[] = [];
      if (goalBlock) trailing.push({ id: "userRules:goal", text: goalBlock });
      if (convokeBlock) {
        trailing.push({ id: "userRules:convoke", text: convokeBlock });
      }
      if (teamLeadBlock) {
        trailing.push({ id: "userRules:team", text: teamLeadBlock });
      }

      const sources = [...ctx.ruleSources, ...trailing];
      if (sources.length === 0) return null;

      // The concatenation is byte-for-byte the single block this used to be:
      // the opening wrapper and preamble first, each source separated by the
      // blank line it carries, and the closing tag last.
      return [
        {
          name: "userRules",
          text: `\n\n<context name="userRules">\n${RULES_PREAMBLE}`,
          volatile: true,
        },
        ...sources.map((source) => ({
          name: source.id,
          text: `\n\n${source.text}`,
          volatile: true,
        })),
        {
          name: "userRules:end",
          text: "\n</context>",
          volatile: true,
        },
      ];
    },
  },
  {
    // Last, and volatile: the date turns over on its own and the status tracks
    // uncommitted work, so neither is allowed to move the cached head of the prefix.
    id: "environment",
    kind: "diffable",
    build: () => ({
      name: "environment",
      text: environmentSection(),
      volatile: true,
    }),
  },
]);

export async function buildSystemMessageSections(
  mode: PermissionMode,
  additionalRules?: string[],
  format?: OutputFormat,
  headless?: boolean,
  profile?: PromptProfile,
): Promise<SystemMessageSection[]> {
  const ruleSources = await collectRuleMaterial(additionalRules);

  // Each part of the prefix is built as its own section so a later request can
  // say which part moved instead of only that the system message differs: the
  // cached prefix is billed as a whole, and the only fix for a move is knowing
  // what caused it. A section that does not apply to this request shape is
  // omitted entirely rather than emitted empty, which is what keeps the prefix
  // bytes free of conditional husks.
  const ctx: SectionBuildContext = {
    mode,
    format,
    headless,
    profile,
    ruleSources,
  };

  const sections: SystemMessageSection[] = [];
  for (const definition of SECTION_REGISTRY) {
    const built = definition.build(ctx);
    if (built === null) continue;
    if (Array.isArray(built)) {
      sections.push(...built);
    } else {
      sections.push(built);
    }
  }
  return sections;
}

/**
 * The prefix is the concatenation of its sections, each of which already carries
 * the blank lines that separate it, so joining adds nothing.
 */
export {
  SYSTEM_SECTION_MARKERS,
  describeSystemMessageChange,
  describeSystemMessageTextChange,
  joinSystemMessageSections,
  splitSystemMessageBySections,
} from "./systemMessageSections.js";

export async function constructSystemMessage(
  mode: PermissionMode,
  additionalRules?: string[],
  format?: OutputFormat,
  headless?: boolean,
  profile?: PromptProfile,
): Promise<string> {
  return joinSystemMessageSections(
    await buildSystemMessageSections(
      mode,
      additionalRules,
      format,
      headless,
      profile,
    ),
  );
}
