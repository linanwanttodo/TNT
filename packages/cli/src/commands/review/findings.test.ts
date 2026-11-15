import { readFileSync } from "fs";

import { describe, expect, it } from "vitest";

import { FINDINGS_CONTRACT, orderFindings, parseFindings } from "./findings.js";

const block = (lines: string): string =>
  `I looked at the diff.\n\n<tnt-findings>\n${lines}\n</tnt-findings>\n\nSome closing words.`;

describe("parseFindings", () => {
  it("reads a well formed block", () => {
    const parsed = parseFindings(
      block("high|src/a.ts:42|The lock is not released on the error path"),
    );

    expect(parsed?.findings).toEqual([
      {
        severity: "high",
        file: "src/a.ts",
        line: 42,
        message: "The lock is not released on the error path",
      },
    ]);
    expect(parsed?.unread).toEqual([]);
  });

  it("leaves the line out when the reviewer only names a file", () => {
    const parsed = parseFindings(
      block("low|src/b.ts|Consider a name that says what it holds"),
    );

    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.findings[0].line).toBeUndefined();
    expect(parsed?.findings[0].file).toBe("src/b.ts");
  });

  it("gives nothing when the reviewer wrote no block", () => {
    expect(
      parseFindings("Two things to fix, listed in prose."),
    ).toBeUndefined();
  });

  it("keeps the lines it can read and reports what it could not", () => {
    const findings = parseFindings(
      block(
        [
          "critical|src/c.ts:7|Deletes the user's data",
          "this line was not a finding",
          "enormous|src/d.ts:1|An severity the order does not know",
        ].join("\n"),
      ),
    );

    expect(findings?.findings).toHaveLength(1);
    expect(findings?.unread).toEqual([
      "this line was not a finding",
      "enormous|src/d.ts:1|An severity the order does not know",
    ]);
  });

  it("returns nothing for an empty block rather than a fake success", () => {
    expect(parseFindings(block(""))).toMatchObject({ findings: [] });
  });
});

describe("orderFindings", () => {
  it("puts the worst first and breaks ties by file and line", () => {
    const ordered = orderFindings([
      { severity: "medium", file: "src/z.ts", message: "m" },
      { severity: "low", file: "src/a.ts", message: "l" },
      { severity: "medium", file: "src/a.ts", line: 9, message: "m2" },
      { severity: "high", file: "src/a.ts", message: "h" },
      { severity: "medium", file: "src/a.ts", line: 3, message: "m3" },
    ]);

    expect(ordered.map((f) => `${f.severity}:${f.line ?? "-"}`)).toEqual([
      "high:-",
      "medium:3",
      "medium:9",
      "medium:-",
      "low:-",
    ]);
  });

  it("does not change what a finding says", () => {
    const findings = [
      { severity: "low" as const, file: "src/a.ts", message: "keep me" },
    ];

    expect(orderFindings(findings)[0].message).toBe("keep me");
  });
});

describe("the contract the reviewer is given", () => {
  it("names the tags and every severity", () => {
    expect(FINDINGS_CONTRACT).toContain("<tnt-findings>");
    for (const severity of ["critical", "high", "medium", "low"]) {
      expect(FINDINGS_CONTRACT, severity).toContain(severity);
    }
  });

  it("is actually sent to the reviewer", () => {
    const source = readFileSync(
      new URL("./reviewWorker.ts", import.meta.url),
      "utf-8",
    );

    expect(source).toContain("FINDINGS_CONTRACT");
  });
});
