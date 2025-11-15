import { execFileSync } from "child_process";

import { describe, expect, it } from "vitest";

/**
 * Declarations that nothing reads, counted by the compiler rather than by a text scan, and
 * frozen as a ratchet: an entry may only join this list through a deliberate edit, and an
 * entry leaves it by becoming read or by disappearing.
 *
 * The text scan in `packages/cli/src/architecture.test.ts` counts mentions in raw source and
 * therefore treats a name mentioned only in prose as read. That blind spot was not theoretical:
 * this file was first written that way and missed the seven below - the exact capabilities the
 * check exists to keep visible. Asking `tsc --noUnusedLocals` costs a compiler run inside the
 * suite and reports every one of them, so the suite pays the seconds.
 *
 * The seven are the reason the list exists. Four models have a hand-tuned FIM prompt that
 * `getTemplateForModel` never references, plus an unwired language-specific prefilter, diff
 * snippets and a multiline-completion branch: declared, unreachable, and invisible to every
 * other gate. They are left in place, not wired, because core is shared with the IDE
 * extensions and no real model is reachable here to tell a fix from a regression (task #38).
 */
const CAPABILITY_CASES: string[] = [
  "autocomplete/classification/shouldCompleteMultiline.ts:isMidlineCompletion",
  "autocomplete/prefiltering/index.ts:shouldLanguageSpecificPrefilter",
  "autocomplete/snippets/getAllSnippets.ts:getDiffSnippets",
  "autocomplete/templating/AutocompleteTemplate.ts:codestralFimTemplate",
  "autocomplete/templating/AutocompleteTemplate.ts:gptAutocompleteTemplate",
  "autocomplete/templating/AutocompleteTemplate.ts:qwenCoderFimTemplate",
  "autocomplete/templating/AutocompleteTemplate.ts:starcoder2FimTemplate",
];

const UNREAD_DECLARATIONS: string[] = [
  "autocomplete/classification/shouldCompleteMultiline.ts:isMidlineCompletion",
  "autocomplete/context/static-context/StaticContextService.ts:end",
  "autocomplete/context/static-context/StaticContextService.ts:name",
  "autocomplete/context/static-context/StaticContextService.ts:start",
  "autocomplete/filtering/BracketMatchingService.ts:allLines",
  "autocomplete/filtering/test/util.ts:suffix",
  "autocomplete/prefiltering/index.ts:shouldLanguageSpecificPrefilter",
  "autocomplete/snippets/getAllSnippets.ts:getDiffSnippets",
  "autocomplete/templating/AutocompleteTemplate.ts:codestralFimTemplate",
  "autocomplete/templating/AutocompleteTemplate.ts:gptAutocompleteTemplate",
  "autocomplete/templating/AutocompleteTemplate.ts:qwenCoderFimTemplate",
  "autocomplete/templating/AutocompleteTemplate.ts:starcoder2FimTemplate",
  "autocomplete/templating/getStopTokens.ts:DOUBLE_NEWLINE",
  "autocomplete/templating/getStopTokens.ts:WINDOWS_DOUBLE_NEWLINE",
  "autocomplete/util/AutocompleteLoggingService.ts:toLog",
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
  "nextEdit/NextEditEditableRegionCalculator.ts:doesLowerPartOverlap",
  "nextEdit/NextEditEditableRegionCalculator.ts:doesRangePartiallyOverlap",
  "nextEdit/NextEditEditableRegionCalculator.ts:doesUpperPartOverlap",
  "nextEdit/NextEditEditableRegionCalculator.ts:isRangeWithin",
  "nextEdit/NextEditEditableRegionCalculator.ts:printChunks",
  "nextEdit/NextEditProvider.ts:autocompleteCache",
  "nextEdit/NextEditProvider.ts:bracketMatchingService",
  "nextEdit/NextEditProvider.ts:completionStreamer",
  "nextEdit/context/autocompleteContextFetching.ts:completionOptions",
  "nextEdit/context/autocompleteContextFetching.ts:prompt",
  "nextEdit/context/autocompleteContextFetching.ts:suffix",
  "nextEdit/templating/mercuryCoderNextEdit.ts:mercuryNextEditTemplateBuilder",
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
    expect(unread.length).toBeGreaterThan(50);
    for (const capability of CAPABILITY_CASES) {
      expect(unread).toContain(capability);
    }
  });

  it("keeps the set to what is already accounted for", () => {
    expect(unread).toEqual([...UNREAD_DECLARATIONS].sort());
  });
});
