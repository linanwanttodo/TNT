# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TNT is a community fork rebuilt around the CLI: one agent engine driving four surfaces — the Ink TUI, headless `-p` runs, `tnt serve` (HTTP/SSE), and ACP editor sessions. The editor extensions and GUI from the original release are gone.

The per-package guidance for the CLI lives in `packages/cli/AGENTS.md` — read it before working there. The systematic architecture reference is `docs/ARCHITECTURE-tnt.md`, and `packages/cli/ARCHITECTURE-tnt.md` is the rulings ledger whose every number must be reproducible by a command.

## Monorepo layout

| Path                                                                                    | Role                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli`                                                                          | The TNT CLI: Ink TUI, agent engine (`stream/`, `loop/`, `tools/`, `permissions/`, `hooks/`, `subagent/`, …), slash commands, hooks system |
| `core/`                                                                                 | The LLM engine inherited from the upstream project: providers, LLM classes, embeddings                                                    |
| `packages/openai-adapters`                                                              | OpenAI-shaped request/response conversion to provider APIs (e.g. OpenAI-to-Anthropic body conversion)                                     |
| `packages/config-types`, `config-yaml`, `fetch`, `llm-info`, `terminal-security`, `sdk` | Small support packages the CLI and core depend on                                                                                         |

Dependency direction: cli → core → support packages. `packages/cli/src/protocol/boundaries.test.ts` and `src/architecture.test.ts` enforce layer boundaries — the stream/loop engine may not import `ui/`, and module-group coupling is a ratchet that only tightens.

## Commands

Work in the relevant package directory (root `package.json` only has prettier/husky):

```bash
cd packages/cli
npm run lint          # tsc --noEmit + eslint (the type gate)
npx vitest run        # full test suite (~490 files; run a single one: npx vitest run src/ui/UserInput.test.tsx)
npm run format        # prettier --write
npm run build         # validate aliases, then bundle to dist/tnt.js
npm run dev           # tsx src/dev.ts, no build step
```

`core/`: `npm run tsc:check`, `npm test`, `npm run build`.

First build or after touching a support package: `npm run build:local-deps` in `packages/cli` (builds config-types → fetch → llm-info → terminal-security → config-yaml → openai-adapters → core → sdk in order). tsc in `packages/cli` fails with confusing errors when a dependency's dist is stale — the error message may point at the wrong file.

## The guard-test culture

A large share of the root-level tests in `packages/cli/src/*.test.ts` are self-verifying documentation, not feature tests: `docsAccuracy.test.ts` (every path named in the architecture notes must exist), `slashCommandsDoc.test.ts` (slash-command tables in `docs/cli/` and `docs/zh/cli/` must match the builtins in both languages), `keyBindings.test.ts` (the key table in `src/ui/keyBindings.ts` must match both `tui.mdx` docs), `branding.test.ts` (every `TNT_*` env var is whitelisted), `unusedKeys.test.ts` (i18n keys must have callers), `systemPrefixFingerprint.test.ts` (the static system-message spine digest is frozen and its digests must appear in `ARCHITECTURE-tnt.md`).

Practical consequence: adding a command, keybinding, env var, i18n key, or editing the system prompt touches a doc table or a frozen digest at the same time, in both en and zh docs. When a guard fails, it is usually telling you which companion file to edit — update the pair together rather than bypassing the guard.

## Conventions

- Relative imports need explicit extensions (`from "./test.js"`); NodeNext resolution.
- Commits: short imperative conventional style, no AI attribution lines.
- CI runs the full matrix (lint, prettier, core-checks, per-package checks, smoke-api, tests on ubuntu/macos/windows). Windows runners sometimes fail with "no space left on device" — rerun the failed job before suspecting the code.
