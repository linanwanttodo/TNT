import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The onboarding page decides whether a first run asks for a provider at all.
 * Its claims are read back from the flow and its one call site, so changing the
 * gate, the marker or the environment list has to update the page with it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(packageRoot, ...segments), "utf-8");
}

const doc = read("spec", "onboarding.md");
const flow = read("src", "startup", "onboarding.ts");
const services = read("src", "services", "index.ts");
const serve = read("src", "commands", "serve.ts");
const i18n = read("src", "i18n", "index.ts");

describe("spec/onboarding.md agrees with the flow", () => {
  it("reads the page and every source it names", () => {
    expect(doc.length).toBeGreaterThan(400);
    expect(flow).toContain("export async function runOnboardingFlow");
    expect(flow).toContain("initializeWithOnboarding");
    expect(services).toContain("initializeWithOnboarding");
  });

  it("matches the gate in initializeServices and serve's bypass", () => {
    expect(services).toMatch(
      /if \(!initOptions\.headless && !initOptions\.skipOnboarding\)\s*\{\s*await initializeWithOnboarding/,
    );
    expect(serve).toContain("headless: true");
    expect(doc).toMatch(/not headless and `skipOnboarding` is false/);
    expect(doc).toMatch(/`-p` and `serve` never enter it/);
  });

  it("matches the first-run marker", () => {
    expect(flow).toContain('".onboarding_complete"');
    expect(flow).toContain("return !fs.existsSync");
    expect(flow).toContain("new Date().toISOString()");
    expect(flow).toMatch(
      /if \(wasOnboarded\) \{\s*await markOnboardingComplete\(\)/,
    );
    expect(doc).toContain("ISO timestamp");
    expect(doc).toMatch(/only\s+written when `runOnboardingFlow` returns true/);
  });

  it("matches the --config refusal and its failure message", () => {
    expect(flow).toMatch(/if \(configPath !== undefined\) \{\s*return false;/);
    expect(flow).toContain('t("startup.failedToLoadConfigFrom"');
    expect(doc).toContain("startup.failedToLoadConfigFrom");
    expect(doc).toMatch(/neither runs the interactive setup nor marks/);
  });

  it("matches the bedrock shortcut", () => {
    expect(flow).toMatch(/process\.env\.CONTINUE_USE_BEDROCK === "1"/);
    expect(flow).toContain('t("setup.bedrock")');
    expect(doc).toContain("CONTINUE_USE_BEDROCK=1");
    expect(doc).toContain("`setup.bedrock`");
  });

  it("keeps every no-prompt environment the page lists", () => {
    for (const token of [
      'NODE_ENV === "test"',
      'CI === "true"',
      'VITEST === "true"',
      'GITHUB_ACTIONS === "true"',
      "!process.stdin.isTTY",
    ]) {
      expect(flow).toContain(token);
    }
    for (const name of [
      "NODE_ENV=test",
      "CI=true",
      "VITEST=true",
      "GITHUB_ACTIONS=true",
    ]) {
      expect(doc).toContain(name);
    }
    expect(flow).toContain("process.env.ANTHROPIC_API_KEY");
    expect(flow).toContain('t("startup.anthropicKey")');
    expect(doc).toContain("ANTHROPIC_API_KEY");
    expect(doc).toContain("`startup.anthropicKey`");
  });

  it("matches the interactive path and its saved message", () => {
    expect(flow).toContain("await runProviderSetupInk()");
    expect(flow).toContain("await runProviderSetup()");
    expect(flow).toContain("writeConfig(buildConfigYaml(setup))");
    expect(flow).toContain('t("setup.saved"');
    expect(doc).toContain("`runProviderSetupInk()`");
    expect(doc).toContain("`ProviderSetupScreen`");
    expect(doc).toContain("`runProviderSetup()`");
    expect(doc).toContain("`writeConfig()`");
    expect(doc).toContain("`setup.saved`");
    expect(doc).toMatch(/No\s+login or hosted assistant is required/);
  });

  it("keeps the i18n keys it quotes", () => {
    for (const key of [
      '"setup.bedrock"',
      '"startup.anthropicKey"',
      '"setup.saved"',
      '"startup.failedToLoadConfigFrom"',
    ]) {
      expect(i18n).toContain(key);
    }
  });
});
