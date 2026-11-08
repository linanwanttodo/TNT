#!/usr/bin/env node

// Verifies the node-pty native artifacts that build.mjs copies into dist, then
// imports the built chunk so node-pty's own loader runs in a child process.
// Run after `npm run build:bundle`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(process.argv[2] ?? join(__dirname, "..", "dist"));
const platform = `${process.platform}-${process.arch}`;
const prebuildsDir = join(distDir, "prebuilds");
const addonPath = join(prebuildsDir, platform, "pty.node");
const indexPath = join(distDir, "index.js");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

if (!existsSync(indexPath)) {
  fail(`${indexPath} is missing; run npm run build:bundle first`);
}
if (!existsSync(addonPath)) {
  fail(
    `${addonPath} is missing; the bundle cannot load node-pty for ${platform}`,
  );
}

console.log(`node-pty artifacts for ${platform}:`);
for (const file of walk(prebuildsDir).sort()) {
  const size = statSync(file).size;
  console.log(`  ${String(size).padStart(9)}  ${file}`);
}

for (const entry of readdirSync(prebuildsDir)) {
  const helper = join(prebuildsDir, entry, "spawn-helper");
  if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) {
    fail(`${helper} is not executable`);
  }
}

const childCode = `
import { pathToFileURL } from "node:url";
const [chunkPath] = process.argv.slice(1);
const nodePty = (await import(pathToFileURL(chunkPath).href)).default;
if (typeof nodePty?.native?.fork !== "function") {
  throw new Error("chunk loaded but node-pty did not expose a native addon");
}
console.log("loaded chunk and native addon, exports: " + Object.keys(nodePty.native).join(", "));
`;

// The loader is inlined into the chunk that evaluates node-pty's entry module,
// and importing it runs loadNativeModule("pty") against the bundle directory.
const chunkName = readdirSync(distDir)
  .filter((name) => name.endsWith(".js"))
  .find((name) =>
    readFileSync(join(distDir, name), "utf8").includes(
      'loadNativeModule("pty").module',
    ),
  );
if (!chunkName) {
  fail(
    `no bundle chunk under ${distDir} calls loadNativeModule("pty"); ` +
      "node-pty was not bundled as expected",
  );
}
const chunkPath = join(distDir, chunkName);

const output = execFileSync(
  process.execPath,
  ["--input-type=module", "-e", childCode, chunkPath],
  { encoding: "utf8" },
);
process.stdout.write(`child process (${chunkName}): ${output}`);
console.log("PASS: node-pty native addon is present and loadable");
