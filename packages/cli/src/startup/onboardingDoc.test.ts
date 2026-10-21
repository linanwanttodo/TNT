import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/onboarding.md` described the upstream continue CLI's onboarding: log in with
 * Continue, create or update an assistant from the first organization, and write an
 * Anthropic config with `uses: anthropic/claude-4-sonnet`. The shipped flow has none of
 * that - it runs `runProviderSetup`, writes whatever provider the user picks, and the
 * only automatic path is `CONTINUE_USE_BEDROCK=1`. The completion marker
 * (`~/.tnt/.onboarding_complete`) and the headless exclusion were not on the page at all.
 *
 * Each fact below is read from `onboarding.ts` or the service gate that calls it. The
 * page is whitespace-normalized before matching so a wrapped line cannot report a false
 * miss.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "onboarding.md");
const FLOW = path.join(here, "onboarding.ts");
const SERVICES = path.join(packageRoot, "src", "services", "index.ts");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

describe("spec/onboarding.md agrees with the onboarding flow", () => {
  const doc = read(DOC);
  const flat = doc.replace(/\s+/g, " ");
  const flow = read(FLOW);
  const services = read(SERVICES);

  it("reads a flow and a gate that exist", () => {
    expect(doc.length).toBeGreaterThan(700);
    expect(flow).toContain("export async function runOnboardingFlow");
    expect(flow).toContain("export async function initializeWithOnboarding");
  });

  it("names the completion marker the flow writes", () => {
    expect(flow).toContain(".onboarding_complete");
    expect(flat).toContain(".onboarding_complete");
  });

  it("states the headless exclusion only while the gate applies it", () => {
    const gated = /!initOptions\.headless && !initOptions\.skipOnboarding/.test(
      services,
    );
    expect(/not headless/.test(flat)).toBe(gated);
    expect(flat).toContain("skipOnboarding");
  });

  it("states the Bedrock bypass the flow performs", () => {
    expect(flow).toContain('process.env.CONTINUE_USE_BEDROCK === "1"');
    expect(flow).toContain('t("setup.bedrock")');
    expect(flat).toContain("CONTINUE_USE_BEDROCK=1");
    expect(flat).toContain("`setup.bedrock`");
  });

  it("lists every test-environment signal the flow checks", () => {
    for (const signal of ["NODE_ENV", "CI", "VITEST", "GITHUB_ACTIONS"]) {
      expect(flow).toContain(signal);
      expect(flat).toContain(signal);
    }
    expect(flow).toContain("process.stdin.isTTY");
    expect(flat).toContain("stdin is not a TTY");
  });

  it("names the Anthropic key path and its message key", () => {
    expect(flow).toContain("ANTHROPIC_API_KEY");
    expect(flow).toContain('t("startup.anthropicKey")');
    expect(flat).toContain("ANTHROPIC_API_KEY");
    expect(flat).toContain("`startup.anthropicKey`");
  });

  it("does not revive the hosted-login or assistant flow", () => {
    expect(flat).not.toMatch(/log in with continue/i);
    expect(flat).not.toMatch(/claude-4-sonnet/);
  });
});
