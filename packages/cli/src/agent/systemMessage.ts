import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { parseMarkdownRule, RuleObject } from "@tnt/config-yaml";

import { env } from "../config/env.js";
import { processRule } from "../config/hubLoader.js";
import { PermissionMode } from "../permissions/types.js";
import {
  loadAllPlugins,
  selectForcedOutputStyle,
  type PluginOutputStyle,
} from "../plugins/loader.js";
import { readSettingsString } from "../config/settingsFiles.js";
import { getSessionOutputStyle } from "../session/index.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { ConfigServiceState, SERVICE_NAMES } from "../services/types.js";
import { logger } from "../utils/logger.js";

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
    return result.trim() || "Working tree clean";
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

# Communication style
1. Write for someone who stepped away and is coming back: the outcome and the evidence for it, not the order you tried things in.
2. When a task ends, say what changed and what is still open. Do not close by asking whether more is wanted.
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
 * Scan .tnt/rules/ directories for markdown rule files and return the rules with metadata that should be always-applied
 */
export function loadMarkdownRulesWithMetadata(): RuleObject[] {
  const cwd = process.cwd();
  const rulesDirs = [
    path.join(cwd, ".tnt", "rules"),
    path.join(env.continueHome, "rules"),
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
        const content = fs.readFileSync(filePath, "utf-8");
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
  format?: "json",
  headless?: boolean,
): Promise<string> {
  const agentFiles = ["AGENTS.md", "AGENT.md", "CLAUDE.md", "CODEX.md"];

  let agentContent = "";

  try {
    for (const fileName of agentFiles) {
      const filePath = path.join(process.cwd(), fileName);

      if (fs.existsSync(filePath)) {
        agentContent = fs.readFileSync(filePath, "utf-8");
        break; // Use the first found agent file
      }
    }
  } catch (error) {
    // If there's any error reading the file, continue without agent content
    console.warn("Warning: Could not read agent configuration file:", error);
  }

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

  // Add plan mode specific instructions if in plan mode
  if (mode === "plan") {
    systemMessage +=
      '\n<context name="planMode">You are operating in _Plan Mode_, which means that your goal is to help the user investigate their ideas and produce a plan before taking action. You may write documentation files (.md, .mdx, .markdown, .rst, .txt) and read everything, but you must not change code or any other file: a write outside documentation is refused, and the Bash tool only runs commands that cannot modify the project. Ask the user to switch to agent mode if they want changes made. Produce planning artifacts only: an implementation plan, the decisions behind it, and a todo list the user can follow, written to documentation files. Keep the plan concrete, ordered, and tied to specific files.</context>\n';
  }

  // In headless mode, add instructions to be concise and only provide final answers
  if (headless) {
    systemMessage += `

IMPORTANT: You are running in headless mode. Provide ONLY your final answer to the user's question. Do not include explanations, reasoning, or additional commentary unless specifically requested. Be direct and concise.`;
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

  // Add rules section if we have any rules or agent content
  if (agentContent || processedRules.length > 0) {
    systemMessage += '\n\n<context name="userRules">';

    if (agentContent) {
      systemMessage += `\n${agentContent}`;
    }

    // Add processed rules from --rule flags
    if (processedRules.length > 0) {
      const separator = agentContent ? "\n\n" : "\n";
      systemMessage += `${separator}${processedRules.join("\n\n")}`;
    }

    systemMessage += "\n</context>";
  }

  return systemMessage;
}
