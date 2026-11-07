import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "../tools/allBuiltIns.js";

import {
  BEST_OF_N_AGENT,
  BROWSER_AGENT,
  BUILT_IN_AGENTS,
  CI_INVESTIGATOR_AGENT,
  DEBUG_AGENT,
  EXPLORE_AGENT,
  RESEARCH_AGENT,
  SECURITY_REVIEW_AGENT,
  SHELL_AGENT,
  VERIFICATION_AGENT,
  builtInAgentByName,
} from "./builtInAgents.js";

describe("built-in agents", () => {
  it("offers the nine roles by the names the listing tool shows", () => {
    expect(BUILT_IN_AGENTS.map((agent) => agent.name)).toEqual([
      "verification",
      "explore",
      "debug",
      "security-review",
      "shell",
      "ci-investigator",
      "browser",
      "best-of-n",
      "research",
    ]);
    expect(builtInAgentByName("verification")).toBe(VERIFICATION_AGENT);
    expect(builtInAgentByName("explore")).toBe(EXPLORE_AGENT);
    expect(builtInAgentByName("debug")).toBe(DEBUG_AGENT);
    expect(builtInAgentByName("security-review")).toBe(SECURITY_REVIEW_AGENT);
    expect(builtInAgentByName("shell")).toBe(SHELL_AGENT);
    expect(builtInAgentByName("ci-investigator")).toBe(CI_INVESTIGATOR_AGENT);
    expect(builtInAgentByName("browser")).toBe(BROWSER_AGENT);
    expect(builtInAgentByName("best-of-n")).toBe(BEST_OF_N_AGENT);
    expect(builtInAgentByName("research")).toBe(RESEARCH_AGENT);
    expect(builtInAgentByName("configured-agent")).toBeUndefined();
  });

  it("keeps every role name unique and every description usable", () => {
    const names = BUILT_IN_AGENTS.map((agent) => agent.name);
    expect(new Set(names).size).toBe(names.length);
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.description.length, agent.name).toBeGreaterThan(40);
      expect(agent.systemMessage.length, agent.name).toBeGreaterThan(200);
    }
  });

  it("denies only tools that exist, so a deny entry always bites", () => {
    const toolNames = new Set(ALL_BUILT_IN_TOOLS.map((tool) => tool.name));
    for (const agent of BUILT_IN_AGENTS) {
      for (const name of agent.deniedTools ?? []) {
        expect(toolNames.has(name)).toBe(true);
      }
    }
  });

  it("keeps AskQuestion and Exit away from the verifier", () => {
    // AskQuestion would block a delegated run nobody is watching; Exit would
    // end the process the verdict is being reported to.
    expect(VERIFICATION_AGENT.deniedTools).toEqual(["AskQuestion", "Exit"]);
  });

  it("restricts the verifier to no file writes, not to no shell", () => {
    // "readonly" would also drop Bash, and a checker that cannot run the build
    // is reading code and guessing.
    expect(VERIFICATION_AGENT.restriction).toBe("no-writes");
  });

  it("asks for the evidence and the verdict line the parser reads", () => {
    expect(VERIFICATION_AGENT.systemMessage).toMatch(/^VERDICT: PASS$/m);
    expect(VERIFICATION_AGENT.systemMessage).toContain("Command run:");
    expect(VERIFICATION_AGENT.systemMessage).toMatch(
      /cannot (change|create|modify|write) (files|anything)/,
    );
  });

  it("confines PARTIAL to what the environment made impossible (T3.5)", () => {
    // "I am not sure" is not an environment limit; the prompt has to say so,
    // or a hedging verifier reports PARTIAL for checks it simply did not run.
    expect(VERIFICATION_AGENT.systemMessage).toContain(
      "It is not for uncertainty",
    );
    expect(VERIFICATION_AGENT.systemMessage).toContain(
      "If a check can be run, decide PASS or FAIL",
    );
  });

  it("is described well enough to be chosen on", () => {
    expect(VERIFICATION_AGENT.description).toContain("verdict");
  });

  it("keeps exploration read-only, including the shell", () => {
    expect(EXPLORE_AGENT.restriction).toBe("readonly");
    expect(EXPLORE_AGENT.systemMessage).toMatch(
      /cannot create or modify files/,
    );
    expect(EXPLORE_AGENT.description).toContain("file:line");
  });

  it("lets debugging run a failing command but not edit the fix", () => {
    expect(DEBUG_AGENT.restriction).toBe("no-writes");
    expect(DEBUG_AGENT.systemMessage).toMatch(/cannot create or modify files/);
    expect(DEBUG_AGENT.systemMessage).toContain("Root cause");
    expect(DEBUG_AGENT.systemMessage).toContain("Verification");
  });

  it("keeps the security review evidence-led and read-only for files", () => {
    expect(SECURITY_REVIEW_AGENT.restriction).toBe("no-writes");
    expect(SECURITY_REVIEW_AGENT.systemMessage).toContain("Severity");
    expect(SECURITY_REVIEW_AGENT.systemMessage).toMatch(
      /Do not report a style preference/,
    );
  });

  it("runs commands without handing over the files", () => {
    expect(SHELL_AGENT.restriction).toBe("no-writes");
    expect(SHELL_AGENT.systemMessage).toMatch(/cannot create or modify files/);
    expect(SHELL_AGENT.systemMessage).toContain("exit code");
    expect(SHELL_AGENT.description).toContain("exit code");
  });

  it("reads a failing run and says when it cannot", () => {
    expect(CI_INVESTIGATOR_AGENT.restriction).toBe("no-writes");
    expect(CI_INVESTIGATOR_AGENT.systemMessage).toContain(
      "first line that failed",
    );
    // The honest-degradation branch is the point: a forge it cannot reach must
    // not become a guessed cause.
    expect(CI_INVESTIGATOR_AGENT.systemMessage).toContain("unreachable");
    expect(CI_INVESTIGATOR_AGENT.description).toContain("Degrades honestly");
  });

  it("describes a page it can only see, and says so", () => {
    expect(BROWSER_AGENT.restriction).toBe("no-writes");
    expect(BROWSER_AGENT.systemMessage).toContain("cannot read the DOM");
    expect(BROWSER_AGENT.systemMessage).toContain(
      "Everything you get is a picture",
    );
    expect(BROWSER_AGENT.description).toContain("Visual only");
  });

  it("proposes candidates and applies none of them", () => {
    // "readonly" is the whole contract: the parent applies the winner, so no
    // candidate can land in the tree before the comparison is read.
    expect(BEST_OF_N_AGENT.restriction).toBe("readonly");
    expect(BEST_OF_N_AGENT.systemMessage).toContain("diff sketch");
    expect(BEST_OF_N_AGENT.systemMessage).toContain("Ranking");
    expect(BEST_OF_N_AGENT.description).toContain("Applies nothing");
  });

  it("answers research questions with cited sources and marked inference", () => {
    expect(RESEARCH_AGENT.restriction).toBe("no-writes");
    expect(RESEARCH_AGENT.systemMessage).toMatch(
      /cannot create or modify files/,
    );
    // Every finding carries where it came from; a claim without a source is
    // not reported.
    expect(RESEARCH_AGENT.systemMessage).toContain("Source");
    expect(RESEARCH_AGENT.systemMessage).toContain("Confidence");
    expect(RESEARCH_AGENT.description).toContain("sources");
  });

  it("keeps AskQuestion and Exit away from every role", () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.deniedTools, agent.name).toEqual(["AskQuestion", "Exit"]);
    }
  });
});

describe("the roles the documentation promises", () => {
  const docsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "docs",
  );
  const pages = [
    path.join(docsRoot, "cli", "subagents.mdx"),
    path.join(docsRoot, "zh", "cli", "subagents.mdx"),
  ];

  it("lists every built-in role on both sites, and nothing else", () => {
    const names = BUILT_IN_AGENTS.map((agent) => agent.name);
    for (const page of pages) {
      const text = fs.readFileSync(page, "utf-8");
      // Every role is named in the table, in code spans, so a role added to the
      // code without a line here is caught on the commit that adds it.
      for (const name of names) {
        expect(text, `${path.basename(page)}: ${name}`).toContain(
          `\`${name}\``,
        );
      }
      // And a role the table invents would be a promise nothing implements.
      const listed = [...text.matchAll(/^\|\s*`([a-z-]+)`/gm)].map(
        (match) => match[1] as string,
      );
      expect(listed.sort(), path.basename(page)).toEqual([...names].sort());
    }
  });
});
