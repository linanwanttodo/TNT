---
globs: ["core/**/*", "packages/**/*"]
description: Provides test running instructions for the engine and the CLI
alwaysApply: false
---

When working with test files, use the following commands to run tests:

Core tests:

- Run Jest tests: `cd core && npm test`
- Run Vitest tests: `cd core && npm run vitest`

CLI tests:

- Run one file: `cd packages/cli && npx vitest run src/path/to/file.test.ts`
- Run the e2e suite: `cd packages/cli && npx vitest run --config vitest.e2e.config.ts`

Packages tests:

- Run one package: `cd packages/<name> && npx vitest run`

Test file patterns:

- Core: `*.test.ts` files use Jest, `*.vitest.ts` files use Vitest
- CLI and packages: `*.test.ts` use Vitest, `*.e2e.test.ts` run under the e2e config

Best practices:

- We are transitioning to vitest, so use that when creating new tests
- Build the workspace before an e2e run, since those suites spawn the built bundle
