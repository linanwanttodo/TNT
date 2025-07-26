// Entry point for `npm run dev`: runs the CLI straight from TypeScript sources
// so iteration does not need a bundle build. src/index.ts is a library module
// that only exports runCli, which is why it cannot be used as the entry.
import { runCli } from "./index.js";

await runCli();
