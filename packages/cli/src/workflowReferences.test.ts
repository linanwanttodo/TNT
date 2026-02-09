import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * `BUILD_DEPENDENCIES.md` is the one place that says which workflow needs which
 * credential, so it is read by whoever has to un-skip a release job. It had
 * drifted until a third of its rows named workflows this repository no longer
 * contains - the extension release chains, a Runloop blueprint upload, four
 * agent jobs - because nothing checked a markdown table.
 *
 * Both directions are held: a name in the document must exist on disk, and a
 * workflow on disk must appear in the document. The second half is what makes
 * adding a job an act of documentation rather than an invisible change. The
 * tables also claim a schedule and a ceiling per workflow, so those two claims
 * are read out of the YAML rather than trusted.
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

function workflowText(name: string): string {
  return fs.readFileSync(path.join(WORKFLOWS, name), "utf8");
}

/**
 * `yaml` reads a bare `on:` as the boolean key `true`, the way GitHub does.
 */
function workflowDocument(name: string): Record<string, any> {
  return parse(workflowText(name)) as Record<string, any>;
}

function triggersOf(document: Record<string, any>): Record<string, any> {
  return document.on ?? document[String(true)] ?? {};
}

/** The `with:` block of the stale-branches step, which is where the sweeper's
 * safety lives. */
function sweeperInputs(): Record<string, unknown> {
  const jobs: Record<string, any> =
    workflowDocument("delete-stale-branches.yaml").jobs ?? {};
  const [job] = Object.values(jobs);
  const step = (job?.steps ?? []).find((entry: any) =>
    String(entry.uses ?? "").startsWith("crs-k/stale-branches@"),
  );
  if (!step) throw new Error("the sweeper no longer runs crs-k/stale-branches");
  return step.with ?? {};
}

/** The table rows that name workflows, with the trigger column beside them. */
function docRows(): { names: string[]; trigger: string }[] {
  const rows: { names: string[]; trigger: string }[] = [];
  for (const line of fs.readFileSync(DOC, "utf8").split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const names = [...cells[0].matchAll(/`([a-z0-9-]+\.(?:yml|yaml))`/g)].map(
      (m) => m[1],
    );
    if (names.length) rows.push({ names, trigger: cells[1] });
  }
  return rows;
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

  it("calls a schedule by the frequency its cron encodes", () => {
    const scheduled: Record<string, string[]> = {};
    for (const file of workflowFiles()) {
      for (const entry of triggersOf(workflowDocument(file)).schedule ?? []) {
        const [, , , , dayOfWeek] = String(entry.cron).split(/\s+/);
        const phrase =
          dayOfWeek === "*"
            ? "daily"
            : dayOfWeek === "1-5"
              ? "weekday"
              : `cron ${entry.cron}`;
        (scheduled[file] ??= []).push(phrase);
      }
    }
    // Two scheduled workflows today; an empty walk would agree with no rows.
    expect(Object.keys(scheduled).sort()).toEqual([
      "delete-stale-branches.yaml",
      "stale-issue-helper.yaml",
    ]);

    const wrong: string[] = [];
    for (const [file, phrases] of Object.entries(scheduled)) {
      const row = docRows().find((entry) => entry.names.includes(file));
      expect(row, `${file} has no row in the tables`).toBeDefined();
      for (const phrase of phrases) {
        if (!row?.trigger.includes(phrase)) {
          wrong.push(
            `${file}: cron says "${phrase}", the table says "${row?.trigger}"`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the ceiling every job promises", () => {
    const missing: string[] = [];
    let jobs = 0;
    for (const file of workflowFiles()) {
      for (const [id, job] of Object.entries(
        workflowDocument(file).jobs ?? {},
      )) {
        jobs++;
        // A job that only forwards to a reusable workflow takes no ceiling of
        // its own; the ceiling belongs inside the reusable workflow.
        if (typeof (job as any).uses === "string") continue;
        if (!(job as any)["timeout-minutes"]) missing.push(`${file}/${id}`);
      }
    }
    expect(jobs).toBeGreaterThanOrEqual(20);
    expect(missing).toEqual([]);
  });

  it("makes the branch sweeper structurally unable to reach a human branch", () => {
    const inputs = sweeperInputs();
    const pattern = String(inputs["branches-filter-regex"] ?? "");
    expect(pattern, "the sweeper must name what it may delete").not.toBe("");

    // crs-k/stale-branches keeps `branches.filter(b => pattern.test(b.branchName))`
    // and deletes what survives the filter, so the regex is a selection, not an
    // exclusion. The previous `^(?!cla-signatures$).*` therefore selected every
    // branch in the repository but one, and on 2026-10-26 its scheduled run
    // deleted 157 of them, 9 named by people (`fix/brace-expansion-vulnerability`,
    // `ollama-models-update`, `call-undefined`). Holding the invariant as names
    // rather than as a wording check is what makes it survive a rewrite: an
    // exclusion pattern goes red here on the first human branch it would match.
    const selection = new RegExp(pattern);
    const human = [
      "main",
      "cla-signatures",
      "release/v1.0.9",
      "dev/p0-hardening",
      "lin/wip-retrieval",
      "fix/empty-text-content-blocks",
    ];
    const bot = [
      "snyk-fix-0350a414d7bb357f145244bbf7f4d12e",
      "dependabot/npm_and_yarn/core/axios-1.16.0",
      "dependabot/github_actions/actions/checkout-5",
      "copilot/fix-the-flaky-test",
      "renovate/typescript-5-x",
    ];

    expect(
      human.filter((name) => selection.test(name)),
      "a human branch is inside the delete set",
    ).toEqual([]);
    expect(
      bot.filter((name) => !selection.test(name)),
      "a bot branch escaped the sweep",
    ).toEqual([]);
    expect(Number(inputs["days-before-delete"])).toBeGreaterThanOrEqual(90);
  });
});
