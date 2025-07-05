import { ContextProviderName } from "..";

export const DEFAULT_PROMPTS_FOLDER_V1 = ".prompts";
export const DEFAULT_PROMPTS_FOLDER_V2 = ".continue-next/prompts";
export const DEFAULT_RULES_FOLDER = ".continue-next/rules";

// Subdirectory names (without .continue-next/ prefix)
export const RULES_DIR_NAME = "rules";
export const PROMPTS_DIR_NAME = "prompts";

export const SUPPORTED_PROMPT_CONTEXT_PROVIDERS: ContextProviderName[] = [
  "file",
  "clipboard",
  "repo-map",
  "currentFile",
  "os",
  "problems",
  "codebase",
  "tree",
  "open",
  "debugger",
  "terminal",
  "diff",
];
