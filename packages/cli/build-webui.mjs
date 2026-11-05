#!/usr/bin/env node

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// The /webui frontend builds here rather than inside build.mjs so its install
// step can be skipped when the dependencies are already in place: npm ci would
// otherwise discard a warm node_modules on every CLI build, and this runs from
// the package's prepare script. build.mjs copies the result into dist/webui.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".");
const webuiRoot = join(packageRoot, "webui");

if (!existsSync(join(webuiRoot, "node_modules"))) {
  run("npm", ["ci", "--no-audit", "--no-fund"], webuiRoot);
}
run("npm", ["run", "build"], webuiRoot);

const shell = join(webuiRoot, "dist", "index.html");
if (!existsSync(shell)) {
  console.error(`The frontend build left no ${shell}`);
  process.exit(1);
}
console.log(`✓ Built the webui frontend at ${join(webuiRoot, "dist")}`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
