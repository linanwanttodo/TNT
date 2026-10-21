import * as path from "path";

import chalk from "chalk";

import {
  isProjectTrusted,
  projectConfigFiles,
  trustProject,
} from "../config/trust.js";
import { t } from "../i18n/index.js";
import { question } from "../utils/prompt.js";

interface TrustPromptOptions {
  cwd?: string;
  /**
   * Test/CI runs and pipes have nobody to answer; the services call site
   * passes nothing and the default refuses to prompt there.
   */
  interactive?: boolean;
  ask?: (prompt: string) => Promise<string>;
}

function defaultInteractive(): boolean {
  const testEnv =
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    process.env.VITEST === "true" ||
    process.env.GITHUB_ACTIONS === "true";
  return !!process.stdin.isTTY && !testEnv;
}

/**
 * Asks before a project's settings, hooks and MCP servers are applied for the
 * first time, and records trust for the current contents when granted. Runs
 * before the services read the project layers, so a granted trust covers the
 * first load; refusing leaves the layers ignored with their warning.
 * Headless and serve never reach this and keep the --trust-project gate.
 */
export async function maybePromptForProjectTrust(
  options: TrustPromptOptions = {},
): Promise<void> {
  const interactive = options.interactive ?? defaultInteractive();
  if (!interactive) return;

  const cwd = options.cwd ?? process.cwd();
  const files = projectConfigFiles(cwd);
  if (files.length === 0 || isProjectTrusted(cwd)) return;

  console.log(chalk.blue(t("startup.trustTitle")));
  for (const file of files) {
    console.log(`  ${path.relative(cwd, file)}`);
  }

  const ask = options.ask ?? question;
  const answer = (await ask(t("startup.trustQuestion"))).trim().toLowerCase();
  if (answer === "y" || answer === "yes") {
    trustProject(cwd);
    console.log(chalk.green(t("startup.trustGranted")));
  }
}
