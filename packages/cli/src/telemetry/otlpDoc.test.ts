import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/otlp-metrics.md` is an operator page: it tells someone which variables to set
 * before the CLI will send anything to a collector. It had drifted in both directions -
 * the interval default said 60000 while the code uses 20000, and three instruments were
 * marked unimplemented after the service had started creating them. Both are the kind
 * of error that costs an afternoon of "why is my dashboard empty".
 *
 * The instrument names and the numeric defaults are read from the service, so adding or
 * removing one reddens this page until it catches up.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "otlp-metrics.md");
const SERVICE = path.join(here, "telemetryService.ts");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function instruments(): string[] {
  return [
    ...new Set(
      [...read(SERVICE).matchAll(/"continue_cli_[a-z_]+"/g)].map((m) =>
        m[0].slice(1, -1),
      ),
    ),
  ].sort();
}

describe("spec/otlp-metrics.md agrees with the telemetry service", () => {
  const doc = read(DOC);
  const service = read(SERVICE);

  it("reads a service that registers a full instrument set", () => {
    expect(doc.length).toBeGreaterThan(800);
    expect(instruments().length).toBeGreaterThanOrEqual(12);
  });

  it("names every instrument the service creates", () => {
    expect(instruments().filter((name) => !doc.includes(name))).toEqual([]);
  });

  it("states the export interval the service defaults to", () => {
    const fallback = service.match(
      /OTEL_METRIC_EXPORT_INTERVAL \|\| "(\d+)"/,
    )?.[1];
    expect(fallback).toBeDefined();
    expect(doc).toContain(fallback!);
    expect(doc).not.toContain("60000");
  });

  it("names the two enablement variables the service reads", () => {
    for (const name of [
      "CONTINUE_METRICS_ENABLED",
      "CONTINUE_CLI_ENABLE_TELEMETRY",
    ]) {
      expect(service).toContain(name);
      expect(doc).toContain(name);
    }
  });

  it("states the exporter default the service falls back to", () => {
    expect(/OTEL_METRICS_EXPORTER \|\| "console"/.test(service)).toBe(true);
    expect(doc).toMatch(/default is `console`/);
  });

  it("claims logs are not exported only while the service says so", () => {
    expect(/TODO: Implement OTLP logs export/.test(service)).toBe(
      /not implemented/.test(doc),
    );
  });
});
