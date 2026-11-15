import { describe, expect, it } from "vitest";

import { parseVerdict } from "./verdict.js";

describe("parseVerdict", () => {
  it("reads a verdict that stands on its own line", () => {
    expect(parseVerdict("build ok, tests ok\nVERDICT: PASS")).toBe("pass");
    expect(parseVerdict("the check failed\nVERDICT: FAIL")).toBe("fail");
    expect(parseVerdict("no test framework here\nVERDICT: PARTIAL")).toBe(
      "partial",
    );
  });

  it("tolerates indentation and trailing space but not a decoration", () => {
    expect(parseVerdict("  VERDICT: PASS  ")).toBe("pass");
    expect(parseVerdict("**VERDICT: PASS**")).toBeUndefined();
    expect(parseVerdict("VERDICT: PASS.")).toBeUndefined();
  });

  it("does not read a verdict out of prose about the format", () => {
    expect(
      parseVerdict("do not write VERDICT: PASS inside a sentence"),
    ).toBeUndefined();
    expect(
      parseVerdict("the contract is:\n\n```\nVERDICT: <PASS|FAIL>\n```"),
    ).toBeUndefined();
  });

  it("takes the last verdict, which is the one at the end of the report", () => {
    expect(
      parseVerdict(
        "first run was green\nVERDICT: PASS\nre-ran after finding the race\nVERDICT: FAIL",
      ),
    ).toBe("fail");
  });

  it("ignores a keyword it does not know", () => {
    expect(parseVerdict("VERDICT: MAYBE")).toBeUndefined();
    expect(parseVerdict("VERDICT:")).toBeUndefined();
    expect(parseVerdict("")).toBeUndefined();
  });
});
