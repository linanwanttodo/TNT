import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Applies the upstream patches this vendored closure depends on. It runs as a
// postinstall hook from each package directory and is idempotent, so a fresh
// npm install produces the same patched dependency tree every time.

const vendorRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const patchesDir = path.join(vendorRoot, "patches");
const packageDir = process.cwd();

const PATCHES = [
  {
    dependency: "@extend-ai/react-xlsx",
    version: "0.16.0",
    patch: "@extend-ai__react-xlsx@0.16.0.patch",
  },
  {
    dependency: "@aiden0z/pptx-renderer",
    version: "1.2.4",
    patch: "@aiden0z__pptx-renderer@1.2.4.patch",
  },
  {
    dependency: "vitest",
    version: "4.1.7",
    patch: "vitest@4.1.7.patch",
  },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function findSequence(haystack, needle) {
  if (needle.length === 0) return -1;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function parseHunks(patchText) {
  const lines = patchText.split(/\r?\n/);
  const files = [];
  let current = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim().replace(/^b\//, "");
      current = { file: target, hunks: [] };
      files.push(current);
      i++;
      continue;
    }

    const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkHeader) {
      if (!current) throw new Error(`hunk without a target file: ${line}`);
      let oldRemaining =
        hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2]);
      let newRemaining =
        hunkHeader[4] === undefined ? 1 : Number(hunkHeader[4]);
      const hunk = { oldLines: [], newLines: [] };
      i++;

      while (i < lines.length && (oldRemaining > 0 || newRemaining > 0)) {
        const body = lines[i];
        if (body.startsWith("\\")) {
          i++;
          continue;
        }
        if (body.startsWith("+")) {
          hunk.newLines.push(body.slice(1));
          newRemaining--;
        } else if (body.startsWith("-")) {
          hunk.oldLines.push(body.slice(1));
          oldRemaining--;
        } else {
          const context = body.startsWith(" ") ? body.slice(1) : body;
          hunk.oldLines.push(context);
          hunk.newLines.push(context);
          oldRemaining--;
          newRemaining--;
        }
        i++;
      }

      if (oldRemaining !== 0 || newRemaining !== 0) {
        throw new Error(`truncated hunk in patch: ${line}`);
      }
      current.hunks.push(hunk);
      continue;
    }

    i++;
  }

  return files;
}

function applyPatch(patchPath, dependencyDir) {
  const files = parseHunks(fs.readFileSync(patchPath, "utf8"));
  const patchName = path.basename(patchPath);
  let applied = 0;
  let alreadyApplied = 0;

  for (const { file, hunks } of files) {
    const target = path.join(dependencyDir, file);
    if (!fs.existsSync(target)) {
      throw new Error(`${patchName}: missing target ${target}`);
    }

    const original = fs.readFileSync(target, "utf8");
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const targetLines = original.split(/\r?\n/);
    let changed = false;

    for (const hunk of hunks) {
      if (findSequence(targetLines, hunk.oldLines) === -1) {
        if (findSequence(targetLines, hunk.newLines) !== -1) {
          alreadyApplied++;
          continue;
        }
        throw new Error(
          `${patchName}: hunk does not match ${target}; upstream may have changed`,
        );
      }
      const index = findSequence(targetLines, hunk.oldLines);
      targetLines.splice(index, hunk.oldLines.length, ...hunk.newLines);
      changed = true;
      applied++;
    }

    if (changed) {
      fs.writeFileSync(target, targetLines.join(eol));
    }
  }

  return { applied, alreadyApplied };
}

const manifest = readJson(path.join(packageDir, "package.json"));
const declared = {
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.optionalDependencies,
};

for (const entry of PATCHES) {
  if (!(entry.dependency in declared)) continue;

  const dependencyDir = path.join(packageDir, "node_modules", entry.dependency);
  const installedManifest = path.join(dependencyDir, "package.json");
  if (!fs.existsSync(installedManifest)) continue;

  const installedVersion = readJson(installedManifest).version;
  if (installedVersion !== entry.version) {
    throw new Error(
      `${entry.dependency}: patch targets ${entry.version}, found ${installedVersion}`,
    );
  }

  const result = applyPatch(path.join(patchesDir, entry.patch), dependencyDir);
  console.log(
    `[vendor-patches] ${entry.dependency}@${installedVersion}: ${result.applied} hunk(s) applied, ${result.alreadyApplied} already present`,
  );
}
