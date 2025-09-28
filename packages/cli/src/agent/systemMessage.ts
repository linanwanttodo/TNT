import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { parseMarkdownRule, RuleObject } from "@tnt/config-yaml";

import { env } from "../config/env.js";
import { processRule } from "../config/hubLoader.js";
import type { OutputFormat } from "../config/outputFormat.js";
import { readSettingsString } from "../config/settingsFiles.js";
import { PermissionMode } from "../permissions/types.js";
import {
  loadAllPlugins,
  selectForcedOutputStyle,
  type PluginOutputStyle,
} from "../plugins/loader.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { ConfigServiceState, SERVICE_NAMES } from "../services/types.js";
import { getSessionOutputStyle } from "../session/index.js";
import { logger } from "../utils/logger.js";

import { loadInstructionFile } from "./instructionIncludes.js";
import {
  PLAN_MODE_TEXT,
  profileSection,
  type PromptProfile,
} from "./promptProfiles.js";

// Static, because everything ahead of the user's own text is inside the cached
// prefix of every request in the session.
export const RULES_PREAMBLE =
  "These instructions come from the user's own files for this project and override how you would otherwise choose to work. Follow each one. Where two of them conflict, the one closer to the project and to the file being changed wins; say which you followed when the choice mattered. When a request cannot be met under them, say so instead of quietly dropping the rule.";

/**
 * Check if current directory is a git repository
 */
function isGitRepo(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

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
 * Get git status
 */
function getGitStatus(): string {
  try {
    if (!isGitRepo()) {
      return "Not a git repository";
    }
    const result = execSync("git status --porcelain", {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    return formatGitStatus(result);
  } catch {
    return "Git status not available";
  }
}

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

# Communication style
1. Lead with the answer or the outcome. When something could not be verified, say that first.
2. Write for someone who stepped away and is coming back: what changed, the evidence for it, and what is still open - not the order things were tried in.
3. One idea per sentence, with a verb. No em dashes, no arrows, no parenthetical asides.
4. Keep code and numbers out of prose; name a file or flag only when the reader has to go there, and put commands and their output in a fenced block.
5. Reference a location as path:line.
6. Stop when the content stops: no closing offer, and no restating what the user can already see.
7. Do not narrate your own reasoning, and do not announce that a task needed no tools.
Here is useful information about the environment you are running in:
<env>
Working directory: ${process.cwd()}
Is directory a git repo: ${isGitRepo()}
Platform: ${process.platform}
Today's date: ${new Date().toISOString().split("T")[0]}
</env>

As you answer the user's questions, you can use the following context:

<context name="gitStatus">This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.

${getGitStatus()}
</context>`;

async function getConfigYamlRules(): Promise<string[]> {
  const configState = await serviceContainer.get<ConfigServiceState>(
    SERVICE_NAMES.CONFIG,
  );
  if (configState.config?.rules) {
    // Extract systemMessage from the config if it exists
    const rules = configState.config.rules;
    return rules
      .map((rule) => {
        return typeof rule === "string" ? rule : rule?.rule;
      })
      .filter((rule): rule is string => !!rule);
  }

  return [];
}

function getRuleNameFromPath(filePath: string): string {
  const segments = filePath.split(/[/\\]/);
  const lastTwoParts = segments.slice(-2);
  return lastTwoParts.filter(Boolean).join("/").replace(/\.md$/, "");
}

/**
 * The tier deployed for the whole machine, ahead of any personal file. Operators
 * point it at their own path rather than mounting one at /etc.
 */
export function managedRulesDir(): string {
  const fromEnv = process.env.CONTINUE_CLI_MANAGED_RULES_DIR;
  if (fromEnv) return fromEnv;
  return process.platform === "win32"
    ? path.join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "TNT", "rules")
    : "/etc/tnt/rules";
}

/**
 * Scan the managed, user and project rules directories for markdown rule files
 * and return the rules with metadata that should be always-applied
 */
export function loadMarkdownRulesWithMetadata(): RuleObject[] {
  const cwd = process.cwd();
  // Ordered least to most specific, the way the reference layers them: a rule
  // deployed for the machine, then the user's own, then the project's.
  const rulesDirs = [
    managedRulesDir(),
    path.join(env.continueHome, "rules"),
    path.join(cwd, ".tnt", "rules"),
  ];

  const rules: RuleObject[] = [];

  for (const dir of rulesDirs) {
    if (!fs.existsSync(dir)) continue;

    let files: string[];
    try {
      files = fs.readdirSync(dir, { recursive: true }) as string[];
    } catch {
      continue;
    }
    // Read order is not promised to be alphabetical, and the rules land in the
    // cached prefix, so the listing is sorted before it is read.
    files = files.map(String).sort();

    for (const file of files) {
      if (!String(file).endsWith(".md")) continue;

      const filePath = path.join(dir, String(file));
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      try {
        const content = loadInstructionFile(filePath);
        const { frontmatter, markdown } = parseMarkdownRule(content);

        if (frontmatter.invokable) continue;

        const isAlwaysApply =
          frontmatter.alwaysApply === true ||
          (frontmatter.alwaysApply === undefined &&
            !frontmatter.globs &&
            !frontmatter.regex);

        if (isAlwaysApply && markdown.trim()) {
          const ruleName =
            frontmatter.name || getRuleNameFromPath(String(file));
          rules.push({
            name: ruleName,
            rule: markdown,
            description: frontmatter.description,
            globs: frontmatter.globs,
            regex: frontmatter.regex,
            alwaysApply: true,
            sourceFile: filePath,
          });
        }
      } catch {
        // Skip files that can't be read or parsed
      }
    }
  }

  return rules;
}

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
export async function constructSystemMessage(
  mode: PermissionMode,
  additionalRules?: string[],
  format?: OutputFormat,
  headless?: boolean,
  profile?: PromptProfile,
): Promise<string> {
  const agentFiles = ["AGENTS.md", "AGENT.md", "CLAUDE.md", "CODEX.md"];
  const layers: string[] = [];

  try {
    for (const fileName of agentFiles) {
      const filePath = path.join(process.cwd(), fileName);

      if (fs.existsSync(filePath)) {
        // The local file is the personal layer over the committed one, so both
        // are read when both exist, and each says which it is.
        layers.push(
          `Rules from ${fileName}:\n${loadInstructionFile(filePath)}`,
        );
        break; // Use the first found agent file
      }
    }

    const localPath = path.join(process.cwd(), "AGENTS.local.md");
    if (fs.existsSync(localPath)) {
      layers.push(
        `Rules from AGENTS.local.md, which is not committed:\n${loadInstructionFile(localPath)}`,
      );
    }
  } catch (error) {
    // If there's any error reading the file, continue without agent content
    console.warn("Warning: Could not read agent configuration file:", error);
  }

  const agentContent = layers.join("\n\n");

  // Process additional rules from --rule flags
  const processedRules: string[] = [];
  if (additionalRules && additionalRules.length > 0) {
    for (const ruleSpec of additionalRules) {
      try {
        const processedRule = await processRule(ruleSpec);
        processedRules.push(processedRule);
      } catch (error: any) {
        console.warn(
          `Warning: Failed to process rule "${ruleSpec}": ${error.message}`,
        );
      }
    }
  }

  const configYamlRules = await getConfigYamlRules();
  processedRules.push(...configYamlRules);

  // Load markdown rules from .tnt/rules/ directories
  const markdownRules = loadMarkdownRulesWithMetadata();
  // Deduplicate against already-loaded rules
  const existingRulesSet = new Set(processedRules);
  for (const rule of markdownRules) {
    if (!existingRulesSet.has(rule.rule)) {
      processedRules.push(rule.rule);
      existingRulesSet.add(rule.rule);
    }
  }

  // Construct the comprehensive system message
  let systemMessage = baseSystemMessage;

  // Plan is one text, whichever way it was chosen: the permission mode and the
  // profile must not produce two wordings of the same instruction.
  if (mode === "plan") {
    systemMessage += PLAN_MODE_TEXT;
  }

  // The profile is the task-shaped axis. It is skipped when the plan text is
  // already in from the mode, and the default profile adds nothing at all.
  if (profile && profile !== "default" && mode !== "plan") {
    systemMessage += profileSection(profile);
  }

  // In headless mode, add instructions to be concise and only provide final answers
  if (headless) {
    systemMessage += `

IMPORTANT: You are running in headless mode. Provide ONLY your final answer to the user's question. Do not include explanations, reasoning, or additional commentary unless specifically requested. Be direct and concise.

Nobody is watching in real time and no question can be answered mid-task, so asking one blocks the work: for reversible steps that follow from the request, proceed; stop only for destructive actions or a genuine change of scope. Offer follow-ups after the work is done; asking permission before starting it is not the way.`;
  }

  // Add JSON formatting instructions if format is json
  if (format === "json") {
    systemMessage += `

IMPORTANT: You are operating in JSON output mode. Your final response MUST be valid JSON that can be parsed by JSON.parse(). The JSON should contain properties relevant to answer the user's question. You don't need to include any general "response" or "answer" field. Do not include any text before or after the JSON - the entire response must be parseable JSON.

Example response format:
{
  "property": "value"
}`;
  }

  // A plugin may force an output style on as soon as it is enabled. Styles a
  // plugin merely offers are left alone: applying one changes every request
  // prefix until it is switched back, so it stays a user decision.
  systemMessage += buildOutputStyleSection(
    selectOutputStyle(loadAllPlugins().outputStyles),
  );

  // The rules block is the last thing in the prefix, so its own wording stays
  // fixed and only the user's text changes.
  if (agentContent || processedRules.length > 0) {
    const blocks = [RULES_PREAMBLE];
    if (agentContent) blocks.push(agentContent);
    blocks.push(...processedRules);

    systemMessage += `\n\n<context name="userRules">\n${blocks.join(
      "\n\n",
    )}\n</context>`;
  }

  return systemMessage;
}
