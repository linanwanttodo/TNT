# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in dist/
- **Test**: `npm test` - Runs Vitest tests with ESM support
- **Type Check**: `npm run lint` - Runs TypeScript compiler without emitting files for type checking
- **Format**: `npm run format` - Runs Prettier with --write flag to check + fix formatting
- **Start**: `npm start` - Runs the built CLI from dist/tnt.js
- **Development**: `npm run dev` runs `src/dev.ts` through tsx with no build step. After a build, run `node dist/tnt.js`

## Architecture Overview

This is a CLI tool for TNT that provides an interactive AI-assisted development experience. The architecture consists of:

### Core Components

1. **Entry Point** (`src/index.ts`): Main CLI logic with two modes:

   - **Headless mode**: Non-interactive mode for automation/CI
   - **TUI mode**: Terminal User Interface using Ink/React
   - **Standard mode**: Traditional readline-based chat interface

2. **Authentication** (`src/auth/`): WorkOS-based authentication system

   - `ensureAuth.ts`: Handles authentication flow
   - `workos.ts`: WorkOS configuration and token management

3. **Terminal UI** (`src/ui/`): React/Ink-based TUI components

   - `TUIChat.tsx`: Main chat interface component
   - `UserInput.tsx`: Input handling with multi-line support
   - `TextBuffer.ts`: Text display utilities

4. **Tools System** (`src/tools/`): Built-in development tools including:

   - File operations (read, write, list)
   - Code search functionality
   - Terminal command execution
   - Diff viewing
   - Exit tool (headless mode only)

5. **MCP Integration** (`src/services/MCPService.ts`): Model Context Protocol service for extended tool capabilities

6. **Hooks System** (`src/hooks/`): Event interception system for extending CLI behavior

   - `HookService.ts`: Service container integration, loads config and fires events
   - `hookConfig.ts`: Loads hooks from settings files, merges configs from multiple sources
   - `hookRunner.ts`: Executes hook handlers (command, HTTP) with exit code semantics
   - `fireHook.ts`: Convenience functions for firing events from integration points
   - `types.ts`: Claude Code-compatible type definitions for hook inputs/outputs
   - **Config locations** (lowest to highest precedence):
     - `~/.claude/settings.json`, `~/.tnt/settings.json` (user-global)
     - `.claude/settings.json`, `.tnt/settings.json` (project)
     - `.claude/settings.local.json`, `.tnt/settings.local.json` (project-local)
   - **Exit code semantics**: 0 = proceed, 2 = block (stderr becomes feedback), other = non-blocking error
   - **JSON output**: Optional structured output with `hookSpecificOutput` for fine-grained control
   - **Hook types**: `command` (shell), `http` (POST request), `prompt` (single model turn), `agent` (delegated multi-turn run), all handled by `hookRunner.ts`

7. **Slash Command Pipeline** (`src/slash/`): every command source is a loader
   - `types.ts`: `SlashCommand`, `CommandLoader`, `CommandSource`, conflict types
   - `loaders/`: built-in, remote mode, assistant prompts, invokable rules, skills, plugins
   - `resolver.ts`: the first source to claim a name keeps it; later claims are reported as conflicts
   - `service.ts`: `CommandService.create()` runs every loader in parallel and freezes the result
   - `handlers/`: in-process command implementations, grouped by domain
   - `dispatch.ts`: `handleSlashCommands()` entry point
   - `src/commands/`: argv subcommands (`chat`, `serve`, `ls`, `review`, `checks`), separate from slash commands

### Module Layout

`src/` is grouped by layer; only the entry points sit at the top level.

| Path                                                                                                    | Purpose                                                                             |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `index.ts`, `dev.ts`                                                                                    | CLI entry points (bundled build and the tsx dev runner)                             |
| `agent/`                                                                                                | System prompt assembly                                                              |
| `commands/`                                                                                             | argv subcommands: `chat`, `serve`, `ls`, `review`, `checks`                         |
| `compaction/`                                                                                           | History compaction and prefix preservation                                          |
| `config/`                                                                                               | Assistant and configuration loading, env, provider setup, rules                     |
| `platform/`                                                                                             | TNT platform API client                                                             |
| `session/`                                                                                              | Session state, titles, goals, delegated sessions                                    |
| `slash/`                                                                                                | Slash command pipeline: loaders, resolver, handlers, dispatch                       |
| `startup/`                                                                                              | Process bootstrap: console interception, onboarding, info screen, banner, version   |
| `stream/`, `loop/`, `tools/`, `permissions/`, `cache/`, `plugins/`, `hooks/`, `subagent/`, `telemetry/` | Agent engine                                                                        |
| `services/`                                                                                             | Long-lived services resolved through `ServiceContainer`                             |
| `ui/`                                                                                                   | Ink components, hooks, contexts                                                     |
| `i18n/`                                                                                                 | Translations and locale switching                                                   |
| `utils/`                                                                                                | Shared helpers; `logger.ts` writes the file log, `console.ts` gates headless output |

### Key Features

- **Streaming Responses**: Real-time AI response streaming (`streamChatResponse.ts`)
- **Slash Commands**: Built-in commands like `/help`, `/exit`, plus prompt, rule, skill and plugin sources (`src/slash/`)
- **Multi-mode Operation**: Supports TUI, headless, and standard chat modes
- **Tool Integration**: Extensible tool system for development tasks

### Testing Setup

- Uses Vitest with TypeScript and ESM support
- Configuration in `vitest.config.ts`
- Tests should be written with `.test.ts` extension
- The suite is large (roughly 200 files). Add tests alongside new behavior; a change is not done until `npx tsc --noEmit`, `npx vitest run` and `npx prettier --check "src/**/*.{ts,tsx}"` all pass
- Run tests using `npm run test path/or/pattern`

### Build System

- TypeScript compilation with declaration files
- ESNext target with NodeNext module resolution
- Outputs to `dist/` directory
- Source maps and inline sources enabled
- JSX support for React components
- Relative import paths require explicit file extensions, e.g. 'from "./test.js"' instead of 'from "./test"'

### Important rules

- Whenever you create / update a test, you should run the test to be certain that it passes
- If you ever create a PR, you should be sure to check the formatting and linting first with `npm run format` and `npm run lint` / `npm run lint:fix`.
