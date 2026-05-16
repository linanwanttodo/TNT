import * as fs from "fs";
import * as path from "path";

import { parseMarkdownRule, RuleObject } from "@tnt/config-yaml";

import { env } from "../config/env.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { ConfigServiceState, SERVICE_NAMES } from "../services/types.js";

import { loadInstructionFile } from "./instructionIncludes.js";

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
  const fromEnv = process.env.TNT_MANAGED_RULES_DIR;
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

export { getConfigYamlRules };
