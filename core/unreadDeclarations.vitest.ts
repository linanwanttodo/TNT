import { execFileSync } from "child_process";

import { describe, expect, it } from "vitest";

/**
 * Declarations that nothing reads, counted by the compiler rather than by a text scan, and
 * frozen as a ratchet: an entry may only join this list through a deliberate edit, and an
 * entry leaves it by becoming read or by disappearing.
 *
 * The text scan in `packages/cli/src/architecture.test.ts` counts mentions in raw source and
 * therefore treats a name mentioned only in prose as read. That blind spot was not theoretical:
 * this file was first written that way and missed what was then seven lines below - the exact
 * capabilities the check exists to keep visible. Asking `tsc --noUnusedLocals` costs a compiler
 * run inside the suite and reports every one of them, so the suite pays the seconds.
 *
 * Those seven lived in the editor completion engine (`autocomplete/` and `nextEdit/`), which
 * the CLI never called and which has since been deleted along with the session host that drove
 * it, so the entries left the list the way the rule says they do: by disappearing. What the
 * three below stand for is the same shape of problem in the code that remains - a fuzzy matcher,
 * a token counter branch and a reranker expansion that are declared, unreachable, and invisible
 * to every other gate. They are left in place, not wired, because none of them has a reachable
 * model to tell a fix from a regression (task #38).
 */
const CAPABILITY_CASES: string[] = [
  "edit/searchAndReplace/findSearchMatch.ts:findFuzzyMatch",
  "llm/countTokens.ts:isUserOrToolMsg",
  "context/retrieval/pipelines/RerankerRetrievalPipeline.ts:_expandRankedResults",
];

const UNREAD_DECLARATIONS: string[] = [
  "util/BracketMatchingService.ts:allLines",
  "codeRenderer/CodeRenderer.ts:CodeRendererOptions",
  "codeRenderer/CodeRenderer.ts:editorBackground",
  "codeRenderer/CodeRenderer.ts:editorForeground",
  "commands/util.ts:foundInDir",
  "commands/util.ts:uri",
  "config/ConfigHandler.ts:startTime",
  "config/yaml/loadYaml.ts:ideSettings",
  "context/providers/JiraIssuesContextProvider/JiraClient.ts:QueryResults",
  "context/retrieval/pipelines/RerankerRetrievalPipeline.ts:_expandRankedResults",
  "continueServer/stubs/client.ts:response",
  "edit/recursiveStream.ts:DUD_PROMPT_LOG",
  "edit/recursiveStream.ts:RECURSIVE_PROMPT",
  "edit/searchAndReplace/findSearchMatch.ts:findFuzzyMatch",
  "indexing/CodebaseIndexer.ts:filesPerSec",
  "indexing/CodebaseIndexer.ts:progressPercentage",
  "indexing/chunk/ChunkCodebaseIndex.ts:cacheKey",
  "indexing/utils.ts:MAX_DIR_LENGTH",
  "indexing/walkDir.ts:start",
  "llm/countTokens.ts:isUserOrToolMsg",
  "llm/llms/Asksage.ts:AskSageToolCall",
  "llm/llms/Bedrock.ts:_promptCachingMetrics",
  "llm/llms/Ollama.ts:params",
  "llm/llms/OpenAI.ts:convertTool",
  "llm/llms/OpenAI.ts:formatMessageForO1OrGpt5ForResponses",
  "llm/llms/llmTestHarness.ts:encoder",
  "llm/llms/llmTestHarness.ts:streamIndex",
  "llm/logFormatter.ts:lastMessage",
  "llm/openaiTypeConverters.ts:ResponseFunctionCallArgumentsDeltaEvent",
  "llm/openaiTypeConverters.ts:ResponseOutputItem",
];

/**
 * `tsc -p ./` reports paths relative to this package, so the assertion compares on that shape.
 */
const unreadFromCompiler = (): string[] => {
  let output = "";
  try {
    output = execFileSync(
      "npx",
      ["tsc", "-p", "./", "--noEmit", "--noUnusedLocals"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error) {
    // Unread names are diagnostics, so a non-zero exit with output is the expected path.
    output = (error as { stdout?: string }).stdout ?? "";
  }

  const found: string[] = [];
  for (const line of output.split("\n")) {
    const match =
      /^(.+?)\(\d+,\d+\): error TS(?:6133|6138|6196): '([^']+)'/.exec(
        line.trim(),
      );
    if (!match) {
      continue;
    }
    const file = match[1].split("\\").join("/");
    if (/\.(test|spec|vitest)\./.test(file)) {
      continue;
    }
    found.push(`${file}:${match[2]}`);
  }
  return [...new Set(found)].sort();
};

describe("declarations that nothing reads", () => {
  const unread = unreadFromCompiler();

  it("ran a compiler that found the unread names it must know about", () => {
    // Floor, and the part that keeps this honest: a crashed or truncated compiler run
    // reports nothing, which a plain "no new unread names" assertion would pass as green.
    // The floor sat at 50 while the editor engine's declarations were still in the tree;
    // deleting that engine removed 26 of them, so it is set against what remains.
    expect(unread.length).toBeGreaterThan(25);
    for (const capability of CAPABILITY_CASES) {
      expect(unread).toContain(capability);
    }
  });

  it("keeps the set to what is already accounted for", () => {
    expect(unread).toEqual([...UNREAD_DECLARATIONS].sort());
  });
});
