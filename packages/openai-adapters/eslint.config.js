import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import unusedImports from "eslint-plugin-unused-imports";

/**
 * This package had no lint lane: `npm run lint` did not exist and the root config
 * does not reach it. The rules are the TypeScript recommended set without `no-undef`
 * (the compiler already knows the globals, and the rule only produced 255 false
 * positives for `expect` and friends), without `import/order` (prettier owns import
 * layout in this repository), and with unused parameters off - the adapter stubs
 * carry `(body, signal)` to satisfy `BaseLlmApi`, not because they read them.
 *
 * `unused-imports/no-unused-imports` is the exception to that last point: an unused
 * import is never a signature, so it is an error.
 */
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "unused-imports": unusedImports,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "import/order": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // Provider payloads are untyped by nature; the compiler still checks structure.
      "@typescript-eslint/no-explicit-any": "off",
      "unused-imports/no-unused-imports": "error",
      // Adapters implement an AsyncGenerator contract; a route with nothing to stream
      // returns without yielding, and converting it to a plain function would break
      // the interface every caller shares.
      "require-yield": "off",
    },
  },

  // Frozen exemptions: the cases below are real findings this lane is not ready to
  // change (a switch that declares locals without braces, a config name that is an
  // interface on purpose, an empty Gemini object that callers pass through). The list
  // must not grow: a new file that trips these rules is a new finding.
  {
    files: [
      "src/apis/Anthropic.ts",
      "src/apis/Bedrock.ts",
      "src/apis/VertexAI.ts",
      "src/openaiToVercelMessages.ts",
    ],
    rules: { "no-case-declarations": "off" },
  },
  {
    files: ["src/apis/ClawRouter.ts", "src/util/gemini-types.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },
];
