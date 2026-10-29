import { type AssistantConfig } from "@tnt/sdk";
import { createRelativeRuleFilePath } from "core/config/markdown/utils.js";

import { type SlashCommandResult } from "../ui/commands/index.js";

function createInitPrompt(): string {
  const relativeRuleFilepath = createRelativeRuleFilePath("review");
  return `Please analyze this repository and create a comprehensive AGENTS.md file, along with a custom slash command. Use your available tools to understand the project structure, read important files like README.md, package.json, requirements.txt, and other configuration files to understand the technology stack and setup.

Create an AGENTS.md file with the following structure:

# Repository Overview

## Project Description
- What this project does
- Main purpose and goals  
- Key technologies used

## Architecture Overview
- High-level architecture
- Main components and their relationships
- Data flow and system interactions

## Directory Structure
- Important directories and their purposes
- Key files and configuration
- Entry points and main modules

## Development Workflow
- How to build/run the project
- Testing approach
- Development environment setup
- Lint and format commands

Additionally, create a slash command file at ${relativeRuleFilepath} with the following structure:

\`\`\`md
---
invokable: true
---

Review this code for potential issues, including:

<insert custom things to look for based on the repository details you find>

Provide specific, actionable feedback for improvements.
\`\`\`

This slash command will be invokable using /review and will provide instructions for code review tasks common to this repository.

Finally, create the memory file .tnt/TNT.md with exactly this content:

\`\`\`md
# TNT Memory

Notes TNT accumulates across sessions: build or test commands that fail in
non-obvious ways, user preferences, conventions the code does not make obvious.
One short line per note.
\`\`\`

Create the .tnt directory if it does not exist. Keep .tnt/ out of version
control WITHOUT touching .gitignore: append ".tnt/" to .git/info/exclude (the
local exclude file git already reads, which is never committed). Skip this when
the directory is not a git repository.

Please create all three files using the Write tool after analyzing the repository. Focus on providing actionable information that would help both AI agents and human developers understand and work effectively with this codebase. Keep the files concise but informational.`;
}

export async function handleInit(
  _args: string[],
  _assistant: AssistantConfig,
): Promise<SlashCommandResult> {
  const prompt = createInitPrompt();

  return {
    newInput: prompt,
  };
}
