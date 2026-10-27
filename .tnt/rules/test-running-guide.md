---
globs: ["core/**/*", "packages/**/*"]
description: Provides test running instructions for the engine and the CLI
alwaysApply: false
---

When working with test files, use the following commands to run tests:

Core tests:

- Run the suite: `cd core && npm test`
- Run one file: `cd core && npx vitest run util/lcs.vitest.ts`

CLI tests:

- Run one file: `cd packages/cli && npx vitest run src/path/to/file.test.ts`
- Run the e2e suite: `cd packages/cli && npm run test:e2e`

Packages tests:

- Run one package: `cd packages/<name> && npx vitest run`

Test file patterns:

- Core: `*.vitest.ts` — one runner collects them all, so a `.test.ts` there is collected by nothing
- CLI and packages: `*.test.ts` use Vitest, `*.e2e.test.ts` run under the e2e config

Best practices:

- Every package runs Vitest; there is no second runner to check separately
- Build the workspace before an e2e run, since those suites spawn the built bundle
