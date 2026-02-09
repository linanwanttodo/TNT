# Contributing to TNT

## Table of Contents

- [Ways to Contribute](#ways-to-contribute)
  - [Report Bugs](#report-bugs)
  - [Suggest Enhancements](#suggest-enhancements)
  - [Update Documentation](#update-documentation)
- [Setting Up the Environment](#setting-up-the-environment)
  - [Prerequisites](#prerequisites)
  - [Install and Build](#install-and-build)
  - [Run TNT From Source](#run-tnt-from-source)
  - [Preview the Documentation](#preview-the-documentation)
- [Git Workflow](#git-workflow)
- [What Makes a Good PR](#what-makes-a-good-pr)
- [Code Rules](#code-rules)
- [Formatting](#formatting)
- [Testing](#testing)
- [Review Process](#review-process)
- [Adding an LLM Provider](#adding-an-llm-provider)
- [Adding a Model](#adding-a-model)
- [Getting Help](#getting-help)
- [Contributor License Agreement](#contributor-license-agreement-cla)

# Ways to Contribute

## Report Bugs

If you find a bug, [create an issue](https://github.com/linanwanttodo/TNT/issues). A good report includes:

- The exact `tnt` command and flags you ran, plus `tnt --version`
- The terminal, OS and Node.js version
- Steps to reproduce, expected behavior, actual behavior
- The relevant part of the session transcript, or `--output-format stream-json` output for a headless run

## Suggest Enhancements

- First check whether a similar proposal already exists.
- Describe the enhancement in detail and, most importantly, what task it makes possible that is awkward today.
- Runtime behavior changes land through an issue plus a plan in `docs/superpowers/plans/`.

## Update Documentation

Documentation lives in two places and both are part of a feature:

- `docs/` — the Mintlify source. Every page has an English original and a Chinese twin under `docs/zh/`.
- `docs-site/` — the Next.js site that renders `docs/` and is published to GitHub Pages.

A change to a user-visible flag, config key, tool or hook needs the English page, the Chinese page, and the navigation entry in `docs/docs.json` and `docs/docs.zh.json` updated in the same PR.

# Setting Up the Environment

## Prerequisites

- Node.js `v20.20.1`, matching `.nvmrc`: run `nvm use` in the repository root.
- Git, and a package manager that can install `sqlite3` native bindings.

## Install and Build

The packages depend on each other in a fixed order, so build them with the script rather than by hand:

```bash
node ./scripts/build-packages.js   # config-types, terminal-security -> fetch, config-yaml, llm-info -> openai-adapters, sdk
bash scripts/install-dependencies.sh
```

On Windows, run `pwsh scripts/install-dependencies.ps1`.

`core/` is the shared engine layer. The CLI imports it through the `core/*` path mapping in `packages/cli/tsconfig.json`, so it must be built before the CLI type-checks:

```bash
cd core && npm install && npm run build
```

## Run TNT From Source

```bash
cd packages/cli
npm run dev                                    # tsx src/dev.ts, no build needed
npm run build && node dist/tnt.js              # the bundle the e2e suites spawn
```

## Preview the Documentation

```bash
cd docs && npm install && npm run dev          # Mintlify preview
cd docs-site && npm install && npm run dev     # the published site on http://localhost:3005
```

# Git Workflow

`main` is the only long-lived branch. Cut a feature branch from it, open the PR back into it, and keep each commit to one reviewable change.

A CLI release is a tag plus one workflow dispatch: push `v<version>` and run **Release the CLI for every desktop OS** with the same version. A tag ref pushed under a branch name is not a tag — push it as `refs/tags/v<version>`.

# What Makes a Good PR

- Open or comment on an issue before writing code, so the change matches the direction.
- Keep it focused. Unrelated fixes belong in separate PRs.
- New behavior ships with a test that fails without it. Prove the test bites: break the source on purpose and read which test goes red.
- Update both documentation languages when anything user-visible changes.
- For terminal UI changes, attach a recording or screenshot of the real terminal.
- Run the gates locally and paste the output in the PR body.

# Code Rules

One engine drives four surfaces — the interactive terminal, headless, `serve`, and ACP. A change to a capability belongs in the engine; a surface only renders or wires it. A feature that lands on one surface and not the others needs an explicit reason in the PR.

`packages/cli/eslint.config.js` enforces, among others: `max-lines` 500 (blank lines and comments excluded), `max-statements` 50, `complexity` 30, `max-depth` 4, `max-params` 5. When a file crosses a limit, split it — do not add an override.

`packages/cli/spec/` holds the behavioral contracts, and each has a guard test that reads the source. When you change something a spec page describes, update the page and the guard together.

Comments and file names describe behavior in neutral terms. Do not name other products or vendors in them.

# Formatting

Prettier formats JavaScript, TypeScript, JSON, CSS and Markdown from the repository root:

```bash
npm run format         # write
npm run format:check   # verify, this is what CI runs
```

# Testing

```bash
cd packages/cli
npm test                                   # unit tests; e2e is excluded by vitest.config.ts
npm run test:e2e                           # spawns the built bundle - run npm run build first
npx vitest run src/path/to/file.test.ts    # one file
npm run lint                               # tsc --noEmit && eslint .

cd packages/openai-adapters && npm test
cd core && npm test                        # one runner: every suite is *.vitest.ts
```

Provider-facing tests are named `*.live.test.ts` and are excluded from the default run because they need a real key; run one deliberately:

```bash
cd packages/openai-adapters
DEEPSEEK_API_KEY=... npx vitest run src/test/deepseek-cache.live.test.ts
```

Never pipe a test run through `grep` or `head` when you need its exit code — a pipeline reports the last command.

# Review Process

- **Initial review** — a maintainer is assigned as the primary reviewer.
- **Feedback loop** — changes may be requested; the engine boundaries and the guards above are not negotiable, everything else is a discussion.
- **Approval and merge** — once approved, the PR lands on `main`.

# Adding an LLM Provider

TNT runs models through `core/llm/llms`. To add one:

1. Create `core/llm/llms/<Provider>.ts` exporting a class that extends `BaseLLM`. [`LlamaCpp.ts`](./core/llm/llms/LlamaCpp.ts) is the smallest example.
2. Add the provider to the `LLMs` array in [`core/llm/llms/index.ts`](./core/llm/llms/index.ts).
3. If it accepts images, add its provider key to `PROVIDER_SUPPORTS_IMAGES` in [`core/llm/autodetect.ts`](./core/llm/autodetect.ts).
4. If it speaks a wire protocol the CLI has not used before, add the protocol to the selection in `packages/cli/src/config` and its adapter in `packages/openai-adapters`.
5. Add a provider page under `docs/cli/` and its Chinese twin under `docs/zh/cli/`, with a runnable `config.yaml` example, then register both in the navigation files.

# Adding a Model

A model that works with a supported provider needs no code: configure it in `config.yaml`. Add it to the repository only when TNT should recommend it, and then check the pieces that steer behavior:

- `core/llm/autodetect.ts` — `autodetectTemplateType` should recognize the name, or the chat template is picked wrongly.
- `packages/openai-adapters/src/apis/cachePolicy.ts` — prompt-cache behavior, when the provider has one.
- The provider page in `docs/cli/` and `docs/zh/cli/`.

# Getting Help

Open [an issue](https://github.com/linanwanttodo/TNT/issues).

# Contributor License Agreement (CLA)

Every contributor signs the CLA by commenting on the pull request:

```text
I have read the CLA Document and I hereby sign the CLA
```

Reply `recheck` if you have signed before. The CLA-Assistant bot records the signature and marks the check as passed.
