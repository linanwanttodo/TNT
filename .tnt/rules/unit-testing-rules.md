---
name: Unit Testing Rules
description: Guidelines for unit testing in this project
alwaysApply: false
---

For unit testing in this project:

## 1. Testing frameworks

The project uses Vitest for testing, everywhere.

## 2. Test execution location

Run tests from within the specific package directory (e.g., `cd core && ..`).

## 3. Vitest tests

- Test files follow the pattern `*.vitest.ts`
- Run tests using `vitest` from within the specific package/module directory:
  ```bash
  cd [directory] && vitest -- [test file path]
  ```

## 4. Package test scripts

- CLI and `packages/*` test files follow the pattern `*.test.ts`; `core` uses `*.vitest.ts`
- Run the whole suite using `npm test` from within the specific package/module directory:
  ```bash
  cd [directory] && npm test -- [test file path]
  ```

## 5. Test structure

- Write tests as top-level `test()` functions - DO NOT use `describe()` blocks
- Include the function name being tested in the test description for clarity
