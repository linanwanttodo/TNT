import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Vite's dependency prebundling walks up from ui's source tree, so the 3.x
// d3-path that ui installed has to be reachable from packages/node_modules too.
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../ui/node_modules/d3-path/dist/d3-path.mjs");
if (!existsSync(target)) {
  throw new Error(`Missing ${target}; install ui before preparing web`);
}

const shimDirectory = resolve(here, "../../node_modules/d3-path/src");
mkdirSync(shimDirectory, { recursive: true });
writeFileSync(
  resolve(shimDirectory, "index.js"),
  'export * from "../../../zcode-ui/ui/node_modules/d3-path/dist/d3-path.mjs";\n',
);
