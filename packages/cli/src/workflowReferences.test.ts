import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `BUILD_DEPENDENCIES.md` is the one place that says which workflow needs which
 * credential, so it is read by whoever has to un-skip a release job. It had
 * drifted until a third of its rows named workflows this repository no longer
 * contains - the extension release chains, a Runloop blueprint upload, four
 * agent jobs - because nothing checked a markdown table.
 *
 * Both directions are held: a name in the document must exist on disk, and a
 * workflow on disk must appear in the document. The second half is what makes
 * adding a job an act of documentation rather than an invisible change.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");
const DOC = path.join(repoRoot, "BUILD_DEPENDENCIES.md");
const WORKFLOWS = path.join(repoRoot, ".github", "workflows");

const WORKFLOW_NAME = /`([a-z0-9-]+\.(?:yml|yaml))`/g;

function referencedNames(): string[] {
  const text = fs.readFileSync(DOC, "utf8");
  return [...new Set([...text.matchAll(WORKFLOW_NAME)].map((m) => m[1]))];
}

function workflowFiles(): string[] {
  return fs
    .readdirSync(WORKFLOWS)
    .filter((name) => /\.(?:ya?ml)$/.test(name))
    .sort();
}

/**
 * Only the secret table's first column, because the document also names
 * environment variables the engine reads (`TNT_GLOBAL_DIR`, a PATH entry) and
 * those are not credentials a workflow consumes.
 */
function documentedSecrets(): string[] {
  const text = fs.readFileSync(DOC, "utf8");
  const section = text.split(/^## Secrets$/m)[1] ?? "";
  const rows = section.split(/^## /m)[0] ?? "";
  const found = new Set<string>();
  for (const line of rows.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const first = line.split("|")[1] ?? "";
    for (const match of first.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)) {
      found.add(match[1]);
    }
  }
  return [...found];
}

describe("the CI dependency document", () => {
  it("lists workflows that exist", () => {
    const names = referencedNames();
    // A scan that found nothing would pass the check below by accident.
    expect(names.length).toBeGreaterThanOrEqual(10);
    const missing = names.filter(
      (name) => !fs.existsSync(path.join(WORKFLOWS, name)),
    );
    expect(missing).toEqual([]);
  });

  it("documents every workflow the repository ships", () => {
    const files = workflowFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    const documented = new Set(referencedNames());
    expect(files.filter((name) => !documented.has(name))).toEqual([]);
  });

  it("does not promise a credential no workflow reads", () => {
    const names = documentedSecrets();
    const ciText = workflowFiles()
      .map((name) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8"))
      .join("\n");
    const unread = names.filter(
      (name) => !ciText.includes(`secrets.${name}`) && !ciText.includes(name),
    );
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(unread).toEqual([]);
  });
});
