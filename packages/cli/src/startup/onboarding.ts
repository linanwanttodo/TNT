import * as fs from "fs";

import * as path from "path";

import chalk from "chalk";

import type { AuthConfig } from "../auth/workos.js";
import { getApiClient } from "../config/index.js";
import { loadConfiguration } from "../config/loader.js";
import { env } from "../config/env.js";
import {
  CONFIG_PATH,
  buildConfigYaml,
  checkHasAcceptableModel,
  runProviderSetup,
  writeConfig,
} from "../config/providerSetup.js";
import { t } from "../i18n/index.js";

export { checkHasAcceptableModel };

export async function runOnboardingFlow(
  configPath: string | undefined,
): Promise<boolean> {
  // Step 1: Check if --config flag is provided
  if (configPath !== undefined) {
    return false;
  }

  // Step 2: Check for CONTINUE_USE_BEDROCK environment variable first (before test env check)
  if (process.env.CONTINUE_USE_BEDROCK === "1") {
    console.log(chalk.blue(t("setup.bedrock")));
    return true;
  }

  // Step 3: Check if we're in a test/CI environment - if so, skip interactive prompts
  const isTestEnv =
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    process.env.VITEST === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    !process.stdin.isTTY;

  if (isTestEnv) {
    // In test/CI there is nobody to answer the prompts, so an already
    // complete config is left exactly as it is.
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.blue(t("startup.anthropicKey")));
      return false;
    }

    // Otherwise return a minimal working configuration
    return false;
  }

  // Step 4: Ask which provider to use, then for its URL, key and model. The
  // answers become the config file; no provider is assumed.
  const setup = await runProviderSetup();

  writeConfig(buildConfigYaml(setup));
  console.log(chalk.green(t("setup.saved", { path: CONFIG_PATH })));

  return true;
}

export async function isFirstTime(): Promise<boolean> {
  return !fs.existsSync(path.join(env.continueHome, ".onboarding_complete"));
}

export async function markOnboardingComplete(): Promise<void> {
  const flagPath = path.join(env.continueHome, ".onboarding_complete");
  const flagDir = path.dirname(flagPath);

  if (!fs.existsSync(flagDir)) {
    fs.mkdirSync(flagDir, { recursive: true });
  }

  fs.writeFileSync(flagPath, new Date().toISOString());
}

export async function initializeWithOnboarding(
  authConfig: AuthConfig,
  configPath: string | undefined,
) {
  const firstTime = await isFirstTime();

  if (configPath !== undefined) {
    // throw an early error is configPath is invalid or has errors
    try {
      await loadConfiguration(
        authConfig,
        configPath,
        getApiClient(undefined),
        [],
        false,
      );
    } catch (errorMessage) {
      throw new Error(
        `Failed to load config from "${configPath}": ${errorMessage}`,
      );
    }
  }

  if (!firstTime) return;

  const wasOnboarded = await runOnboardingFlow(configPath);
  if (wasOnboarded) {
    await markOnboardingComplete();
  }
}
