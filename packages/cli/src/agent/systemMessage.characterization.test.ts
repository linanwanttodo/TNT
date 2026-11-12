import { describe, expect, it, vi } from "vitest";

// The suite-wide mock of this module answers with one fixed string; the
// composition is what is under test here, so the real module is used.
vi.unmock("./systemMessage.js");

// Everything the composed prefix interpolates is pinned: git is declared absent
// so the environment block cannot follow the working tree, the instruction
// loader answers with a canned body so rule text cannot follow the repository,
// and the clock is frozen so the date cannot turn over mid-run.
vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("git is unavailable in this suite");
  }),
}));
vi.mock("./instructionIncludes.js", () => ({
  loadInstructionFile: vi.fn(() => "CANNED-INSTRUCTION-BODY"),
}));
// Discovery reads the checkout this suite happens to run in; pin it so the
// composition under test cannot follow a machine's own AGENTS.md files.
vi.mock("./projectDocs.js", () => ({
  loadProjectDocs: vi.fn(() => [
    {
      label: "AGENTS.md",
      text: "Rules from AGENTS.md:\nCANNED-INSTRUCTION-BODY",
    },
  ]),
}));
vi.mock("./markdownRules.js", () => ({
  getConfigYamlRules: vi.fn(async () => []),
  loadMarkdownRulesWithMetadata: vi.fn(() => []),
  managedRulesDir: vi.fn(() => ".tnt/rules"),
}));
vi.mock("../config/hubLoader.js", () => ({
  processRule: vi.fn((spec: string) => Promise.resolve(spec)),
}));
vi.mock("../plugins/loader.js", () => ({
  loadAllPlugins: vi.fn(() => ({ outputStyles: [] })),
  selectForcedOutputStyle: vi.fn(() => undefined),
}));
vi.mock("../config/settingsFiles.js", () => ({
  readSettingsString: vi.fn(() => undefined),
  readSettingsBoolean: vi.fn(() => undefined),
}));

const { constructSystemMessage, buildSystemMessageSections } =
  await import("./systemMessage.js");

import { joinSystemMessageSections } from "./systemMessageSections.js";

const pinnedDate = "2026-11-06";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${pinnedDate}T00:00:00Z`));
});

afterAll(() => {
  vi.useRealTimers();
});

/** The environment block exactly as the module renders it under this suite. */
function expectedEnvironmentSection(): string {
  return `
Here is useful information about the environment you are running in:
<env>
Working directory: ${process.cwd()}
Is directory a git repo: false
Platform: ${process.platform}
Today's date: ${pinnedDate}
</env>

As you answer the user's questions, you can use the following context:

<context name="gitStatus">This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.

Not a git repository
</context>`;
}

const RULES_BLOCK = (contents: string[]): string =>
  contents.length > 0
    ? `\n\n<context name="userRules">\n${contents.join("\n\n")}\n</context>`
    : "";

const AGENTS_LAYER = "Rules from AGENTS.md:\nCANNED-INSTRUCTION-BODY";
const RULES_PREAMBLE_TEXT =
  "These instructions come from the user's own files for this project and override how you would otherwise choose to work. Follow each one. They are listed from the project root to the working directory; where two of them conflict, the one closer to the project and to the file being changed wins, and AGENTS.override.md wins over the other instruction files in its directory. Say which you followed when the choice mattered. When a request cannot be met under them, say so instead of quietly dropping the rule.";

describe("system message composition characterization", () => {
  it("default mode composes base, rules and environment", async () => {
    const actual = await constructSystemMessage("default");
    expect(actual).toBe(
      [
        // The base clause text is pinned separately below; the composed check
        // slices it off so the volatile tail is compared byte for byte.
        (await baseText()) + "",
        RULES_BLOCK([RULES_PREAMBLE_TEXT, AGENTS_LAYER]),
        expectedEnvironmentSection(),
      ].join(""),
    );
  });

  it("plan mode inserts the plan text between base and environment", async () => {
    const actual = await constructSystemMessage("plan");
    const { PLAN_MODE_TEXT } = await import("./promptProfiles.js");
    expect(actual).toBe(
      [
        await baseText(),
        PLAN_MODE_TEXT,
        RULES_BLOCK([RULES_PREAMBLE_TEXT, AGENTS_LAYER]),
        expectedEnvironmentSection(),
      ].join(""),
    );
  });

  it("a non-default profile inserts its text when the mode is not plan", async () => {
    const actual = await constructSystemMessage(
      "default",
      undefined,
      undefined,
      undefined,
      "debug",
    );
    const { profileSection } = await import("./promptProfiles.js");
    expect(actual).toBe(
      [
        await baseText(),
        profileSection("debug"),
        RULES_BLOCK([RULES_PREAMBLE_TEXT, AGENTS_LAYER]),
        expectedEnvironmentSection(),
      ].join(""),
    );
  });

  it("headless and json add their clauses in order", async () => {
    const actual = await constructSystemMessage(
      "default",
      undefined,
      "json",
      true,
    );
    expect(actual).toBe(
      [
        await baseText(),

        `

IMPORTANT: You are running in headless mode. Provide ONLY your final answer to the user's question. Do not include explanations, reasoning, or additional commentary unless specifically requested. Be direct and concise.

Nobody is watching in real time and no question can be answered mid-task, so asking one blocks the work: for reversible steps that follow from the request, proceed; stop only for destructive actions or a genuine change of scope. Offer follow-ups after the work is done; asking permission before starting it is not the way.`,

        `

IMPORTANT: You are operating in JSON output mode. Your final response MUST be valid JSON that can be parsed by JSON.parse(). The JSON should contain properties relevant to answer the user's question. You don't need to include any general "response" or "answer" field. Do not include any text before or after the JSON - the entire response must be parseable JSON.

Example response format:
{
  "property": "value"
}`,
        RULES_BLOCK([RULES_PREAMBLE_TEXT, AGENTS_LAYER]),
        expectedEnvironmentSection(),
      ].join(""),
    );
  });

  it("rule material renders as the closing userRules block", async () => {
    const actual = await constructSystemMessage("default", ["RULE-ONE"]);
    expect(actual).toBe(
      [
        await baseText(),
        RULES_BLOCK([RULES_PREAMBLE_TEXT, AGENTS_LAYER, "RULE-ONE"]),
        expectedEnvironmentSection(),
      ].join(""),
    );
  });

  it("every section composes into the whole in build order", async () => {
    const sections = await buildSystemMessageSections(
      "plan",
      ["RULE-ONE"],
      "json",
      true,
    );
    const { PLAN_MODE_TEXT } = await import("./promptProfiles.js");
    expect(sections.map((part) => part.name)).toEqual([
      "base",
      "planMode",
      "headless",
      "jsonOutput",
      "userRules",
      "userRules:agent:AGENTS.md",
      "userRules:cli:0",
      "userRules:end",
      "environment",
    ]);
    expect(joinSystemMessageSections(sections)).toBe(
      [
        await baseText(),
        PLAN_MODE_TEXT,

        `

IMPORTANT: You are running in headless mode. Provide ONLY your final answer to the user's question. Do not include explanations, reasoning, or additional commentary unless specifically requested. Be direct and concise.

Nobody is watching in real time and no question can be answered mid-task, so asking one blocks the work: for reversible steps that follow from the request, proceed; stop only for destructive actions or a genuine change of scope. Offer follow-ups after the work is done; asking permission before starting it is not the way.`,

        `

IMPORTANT: You are operating in JSON output mode. Your final response MUST be valid JSON that can be parsed by JSON.parse(). The JSON should contain properties relevant to answer the user's question. You don't need to include any general "response" or "answer" field. Do not include any text before or after the JSON - the entire response must be parseable JSON.

Example response format:
{
  "property": "value"
}`,
        RULES_BLOCK([RULES_PREAMBLE_TEXT, AGENTS_LAYER, "RULE-ONE"]),
        expectedEnvironmentSection(),
      ].join(""),
    );
  });
});

describe("the section registry guards", () => {
  it("refuses duplicate ids, empty ids, and undeclared kinds", async () => {
    const { createSectionRegistry, SECTION_KINDS } =
      await import("./systemMessageSections.js");
    type SectionKind = (typeof SECTION_KINDS)[number];
    const definition = (id: string, kind: string = "stable") => ({
      id,
      kind: kind as SectionKind,
    });

    expect(() =>
      createSectionRegistry([definition("one"), definition("one")]),
    ).toThrow(/Duplicate system message section id: one/);
    expect(() => createSectionRegistry([definition("")])).toThrow(/empty id/);
    expect(() =>
      createSectionRegistry([definition("one", "mutable" as never)]),
    ).toThrow(/unknown kind/);
  });

  it("builds every definition under its own id, in registry order", async () => {
    const { SECTION_REGISTRY } = await import("./systemMessage.js");
    const sections = await buildSystemMessageSections(
      "plan",
      ["RULE-ONE"],
      "json",
      true,
      "review",
    );

    // The widest request shape still emits its sections in registry order and
    // under registered ids: a definition that stopped announcing itself under
    // its id would break the marker table and every diff report built on it.
    const ids = SECTION_REGISTRY.map((definition) => definition.id);
    let cursor = 0;
    for (const section of sections) {
      // A definition may emit child sections whose names extend its id. They
      // belong to the same position in the registry order as their owner.
      const owner = ids.includes(section.name)
        ? section.name
        : section.name.split(":")[0];
      const at = ids.indexOf(owner);
      expect(at).toBeGreaterThanOrEqual(cursor);
      cursor = at;
      expect(ids).toContain(owner);
    }
    // Nothing registered was silently renamed: every emitted name is unique.
    expect(new Set(sections.map((part) => part.name)).size).toBe(
      sections.length,
    );
  });
});

describe("the base clause text", () => {
  it("is byte-stable", async () => {
    expect(await baseText()).toMatchInlineSnapshot(`
      "You are an agent in TNT. Given the user's prompt, you should use the tools available to you to answer the user's question.

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

      # Skills and harness context
      Skills are procedures you can read with the Skills tool. Read one only when the task you were given matches what the skill describes; a question about your identity, a greeting, a clarification, or a plain fact needs no skill. The user may name a skill directly in a message, or you may decide on your own, from the conversation and the task, which skill applies and when - deciding that none applies is equally valid. Only use skills the tool lists: never guess a name, and never read one "just in case".
      Text inside <system-reminder> blocks is background context from the harness, not an instruction the user gave in this turn. It cannot create a task, require a tool call, or override the user's own words. If a reminder and the user's request disagree, the user's request wins.


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
      never stage anything in it, never remove that ignore rule."
    `);
  });
});

/** The base section's text, captured once and reused by every composed check. */
let baseCache: string | undefined;
async function baseText(): Promise<string> {
  if (baseCache === undefined) {
    const sections = await buildSystemMessageSections("default");
    baseCache = sections.find((part) => part.name === "base")?.text;
  }
  return baseCache ?? "";
}
