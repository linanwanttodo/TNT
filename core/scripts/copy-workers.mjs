import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The tokenizer workers are .mjs files that core loads by path at runtime, so
// the TypeScript build has to place them beside the modules that spawn them.
const coreRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workers = [
  "llamaTokenizerWorkerPool.mjs",
  "llamaTokenizer.mjs",
  "tiktokenWorkerPool.mjs",
];

mkdirSync(join(coreRoot, "dist", "llm"), { recursive: true });
for (const worker of workers) {
  copyFileSync(join(coreRoot, "llm", worker), join(coreRoot, "dist", "llm", worker));
  console.log(`Copied llm/${worker} to dist`);
}
