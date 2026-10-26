import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";

import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";
import { getAllAvailableTools } from "./registry.js";
import { checkIfRipgrepIsInstalled } from "./searchCode.js";
import {
  setBetaSubagentToolEnabled,
  setBetaUploadArtifactToolEnabled,
} from "./toolsConfig.js";

/**
 * The architecture note says the model reaches a language server through four
 * read-only tools and that rename is not one of them. That is a claim about the
 * shipped tool surface, and a rename or a removal would leave the sentence
 * standing while the agent lost the capability - so it is checked against the
 * registry the request is built from, not against a text search of `src/tools`,
 * which also returns names that only appear inside test fixtures.
 *
 * What this does not decide: whether the four behave read-only. That is each
 * tool's own suite.
 */
const READ_ONLY_LSP_TOOLS = [
  "Diagnostics",
  "FindSymbol",
  "Hover",
  "Completion",
  "References",
  "CallHierarchy",
  "DocumentSymbol",
  "Definition",
];

describe("the tool surface the notes describe", () => {
  const names = ALL_BUILT_IN_TOOLS.map((tool) => tool.name);

  it("reads a registry that is really populated", () => {
    // A broken import would hand back an empty list, and every assertion below
    // would pass on nothing.
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(new Set(names).size).toBe(names.length);
  });

  it("offers the eight language-server tools the note names", () => {
    for (const tool of READ_ONLY_LSP_TOOLS) {
      expect(names, tool).toContain(tool);
    }
  });

  it("still leaves rename unexposed, as the note states", () => {
    expect(names).not.toContain("Rename");
  });
});

/**
 * The counterpart of the checks above: every name in the shipped registry has
 * to be reachable from some configuration, and every name that is not has to
 * be declared here with the flag that hides it. Adding a tool to one list and
 * forgetting the other is exactly the drift a single-name assertion cannot
 * catch.
 */
const GATED_TOOLS: Record<string, string> = {
  Exit: "a headless run",
  Status: "--id names an agent",
  ReportFailure: "--id names an agent",
  UploadArtifact: "an agent plus the beta upload flag",
  Subagent: "the beta delegation flag and a run below the depth limit",
  ListSubagents: "the beta delegation flag and a run below the depth limit",
};

/** Names no shipped configuration offers. An entry is a reviewed absence. */
const UNEXPOSED_REASONS: Record<string, string> = {};

const ALL_NAMES = ALL_BUILT_IN_TOOLS.map((tool) => tool.name);
const originalArgv = [...process.argv];

interface RunConfig {
  headless?: boolean;
  agent?: boolean;
  betaSubagent?: boolean;
  betaUpload?: boolean;
  canDelegate?: boolean;
}

async function offered(config: RunConfig): Promise<string[]> {
  process.argv = config.agent
    ? [...originalArgv, "--id", "test-agent"]
    : [...originalArgv];
  setBetaSubagentToolEnabled(config.betaSubagent === true);
  setBetaUploadArtifactToolEnabled(config.betaUpload === true);
  const tools = await getAllAvailableTools(
    config.headless === true,
    config.canDelegate !== false,
  );
  return tools.map((tool) => tool.name);
}

const SHIPPED_CONFIGS: RunConfig[] = [
  {},
  { headless: true },
  { agent: true },
  { betaSubagent: true },
  { agent: true, betaUpload: true },
];

async function offeredByConfigs(configs: RunConfig[]): Promise<Set<string>> {
  const union = new Set<string>();
  for (const config of configs) {
    for (const name of await offered(config)) {
      union.add(name);
    }
  }
  return union;
}

describe("the composed tool surface is a partition", () => {
  beforeEach(() => {
    serviceContainer.registerValue(SERVICE_NAMES.MODEL, {
      model: { name: "test-model" },
    } as never);
    serviceContainer.registerValue(SERVICE_NAMES.MCP, {
      connections: [],
      tools: [],
    } as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    setBetaSubagentToolEnabled(false);
    setBetaUploadArtifactToolEnabled(false);
  });

  it("accounts for every built-in name under some shipped configuration", async () => {
    const union = await offeredByConfigs(SHIPPED_CONFIGS);

    // The two search tools depend on a program on the machine, not on a flag;
    // a machine without it still has to account for every other name.
    const ripgrep = await checkIfRipgrepIsInstalled();
    const declaredAbsent = new Set(Object.keys(UNEXPOSED_REASONS));
    const expected = ALL_NAMES.filter(
      (name) =>
        !declaredAbsent.has(name) &&
        (ripgrep || (name !== "Search" && name !== "Glob")),
    );

    // Floor: a broken import would make both sides empty and the comparison
    // would pass on nothing.
    expect(ALL_NAMES.length).toBeGreaterThanOrEqual(30);
    expect(union.size).toBeGreaterThanOrEqual(28);
    expect([...union].sort()).toEqual([...expected].sort());
  });

  it("names the flag or configuration that adds every gated tool", async () => {
    const tui = new Set(await offered({}));
    for (const [name, reason] of Object.entries(GATED_TOOLS)) {
      expect(tui.has(name), `${name}: ${reason}`).toBe(false);
    }

    const headless = new Set(await offered({ headless: true }));
    expect(headless.has("Exit")).toBe(true);

    const agent = new Set(await offered({ agent: true }));
    expect(agent.has("Status")).toBe(true);
    expect(agent.has("ReportFailure")).toBe(true);

    const upload = new Set(await offered({ agent: true, betaUpload: true }));
    expect(upload.has("UploadArtifact")).toBe(true);

    const beta = new Set(await offered({ betaSubagent: true }));
    expect(beta.has("Subagent")).toBe(true);
    expect(beta.has("ListSubagents")).toBe(true);

    const noDelegate = new Set(
      await offered({ betaSubagent: true, canDelegate: false }),
    );
    expect(noDelegate.has("Subagent")).toBe(false);
    expect(noDelegate.has("ListSubagents")).toBe(false);
  });

  it("keeps every declared gate a real built-in name", () => {
    expect(Object.keys(GATED_TOOLS).length).toBeGreaterThanOrEqual(6);
    const stale = Object.keys(GATED_TOOLS).filter(
      (name) => !ALL_NAMES.includes(name),
    );
    expect(stale).toEqual([]);
  });

  it("keeps the unexposed table empty while every built-in is reachable", () => {
    // A name here is a reviewed absence: the partition test above removes it
    // from what the configurations must offer, so adding one without a reason
    // that holds would leave the guard weaker, not greener.
    expect(UNEXPOSED_REASONS).toEqual({});
  });
});
