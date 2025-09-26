import { describe, expect, it } from "vitest";

import { renderReport } from "./renderReport.js";

const options = {
  baseBranch: "main",
  changedFileCount: 1,
  format: "text" as const,
  checksFromHub: false,
};

const reviewed = (output: string) => ({
  agent: "team/style",
  name: "Style review",
  status: "fail" as const,
  patch: "",
  output,
  duration: 1,
});

describe("the text report with structured findings", () => {
  it("lists them worst first, naming the place to look", () => {
    const text = renderReport(
      [
        reviewed(
          [
            "prose intro",
            "<tnt-findings>",
            "low|src/b.ts|minor naming",
            "high|src/a.ts:42|the lock is never released",
            "</tnt-findings>",
            "prose tail",
          ].join("\n"),
        ),
      ],
      options,
    );

    expect(text).toContain("src/a.ts:42");
    expect(text).toContain("the lock is never released");
    expect(text.indexOf("src/a.ts:42")).toBeLessThan(
      text.indexOf("minor naming"),
    );
  });

  it("shows the block to the reader instead of the markup", () => {
    const text = renderReport(
      [reviewed("<tnt-findings>\nhigh|src/a.ts:1|first\n</tnt-findings>")],
      options,
    );

    expect(text).not.toContain("<tnt-findings>");
  });

  it("keeps the prose when a reviewer wrote no block", () => {
    const text = renderReport(
      [reviewed("Two things I would change, in the order I noticed them.")],
      options,
    );

    expect(text).toContain("in the order I noticed them");
    expect(text).not.toContain("src/");
  });

  it("still shows a line the reader needs even if it was not a finding", () => {
    const text = renderReport(
      [
        reviewed(
          [
            "<tnt-findings>",
            "high|src/a.ts:1|real one",
            "this was not a finding",
            "</tnt-findings>",
          ].join("\n"),
        ),
      ],
      options,
    );

    expect(text).toContain("real one");
    expect(text).toContain("this was not a finding");
  });
});

describe("the json report with structured findings", () => {
  it("carries them as data, worst first, and keeps the raw text", () => {
    const json = JSON.parse(
      renderReport(
        [
          reviewed(
            [
              "<tnt-findings>",
              "low|src/b.ts|minor",
              "critical|src/a.ts:7|deletes user data",
              "</tnt-findings>",
            ].join("\n"),
          ),
        ],
        { ...options, format: "json" as const },
      ),
    );

    expect(json.reviews[0].findings).toEqual([
      {
        severity: "critical",
        file: "src/a.ts",
        line: 7,
        message: "deletes user data",
      },
      { severity: "low", file: "src/b.ts", message: "minor" },
    ]);
    // What the reviewer said stays byte for byte: a consumer that reads the
    // prose must not find it rewritten because a parser arrived.
    expect(json.reviews[0].output).toContain("<tnt-findings>");
  });

  it("says nothing about findings a reviewer did not write", () => {
    const json = JSON.parse(
      renderReport([reviewed("prose only")], {
        ...options,
        format: "json" as const,
      }),
    );

    expect(json.reviews[0].findings).toBeUndefined();
  });
});
