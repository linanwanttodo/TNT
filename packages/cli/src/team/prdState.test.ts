import { describe, expect, it } from "vitest";

import { ILLEGAL_TRANSITIONS, STATE_TABLE, prdStatusOf } from "./prdState.js";

const DISPATCHED = (r: string) => ({
  requirement: r,
  kind: "dispatch" as const,
});

describe("the deterministic PRD state table", () => {
  it("orders the five rows top-down, first match wins", () => {
    expect(STATE_TABLE.map((row) => row.status)).toEqual([
      "未通过",
      "已验收",
      "已实现",
      "开发中",
      "待开发",
    ]);
  });

  it("derives 未通过 from a FAIL/PARTIAL verdict with no later PASS", () => {
    const status = prdStatusOf("R1", [
      DISPATCHED("R1"),
      { requirement: "R1", kind: "verification", verdict: "FAIL" },
    ]);
    expect(status).toBe("未通过");
  });

  it("derives 已验收 when a PASS verdict is the latest evidence", () => {
    const status = prdStatusOf("R1", [
      { requirement: "R1", kind: "verification", verdict: "FAIL" },
      { requirement: "R1", kind: "verification", verdict: "PASS" },
    ]);
    expect(status).toBe("已验收");
  });

  it("keeps 未通过 when FAIL is later than PASS", () => {
    const status = prdStatusOf("R1", [
      { requirement: "R1", kind: "verification", verdict: "PASS" },
      { requirement: "R1", kind: "verification", verdict: "FAIL" },
    ]);
    expect(status).toBe("未通过");
  });

  it("derives 已实现 only from tester or reviewer evidence, not from the implementer's claim", () => {
    const claimed = prdStatusOf("R1", [
      DISPATCHED("R1"),
      { requirement: "R1", kind: "implementer" },
    ]);
    expect(claimed).toBe("开发中");

    const tested = prdStatusOf("R1", [
      DISPATCHED("R1"),
      { requirement: "R1", kind: "tester" },
    ]);
    expect(tested).toBe("已实现");

    const reviewed = prdStatusOf("R1", [
      DISPATCHED("R1"),
      { requirement: "R1", kind: "code-reviewer" },
    ]);
    expect(reviewed).toBe("已实现");
  });

  it("derives 开发中 from a dispatch record alone", () => {
    expect(prdStatusOf("R1", [DISPATCHED("R1")])).toBe("开发中");
  });

  it("falls back to 待开发 with no evidence", () => {
    expect(prdStatusOf("R1", [])).toBe("待开发");
    expect(prdStatusOf("R1", [DISPATCHED("R2")])).toBe("待开发");
  });

  it("treats a tester report and a FAIL verdict on the same round as 未通过", () => {
    const status = prdStatusOf("R1", [
      DISPATCHED("R1"),
      { requirement: "R1", kind: "tester" },
      { requirement: "R1", kind: "verification", verdict: "PARTIAL" },
    ]);
    expect(status).toBe("未通过");
  });
});

describe("illegal PRD status transitions", () => {
  it("outlaws 已验收 -> 待开发 without a change record", () => {
    expect(ILLEGAL_TRANSITIONS).toContainEqual({
      from: "已验收",
      to: "待开发",
      bypass: "变更记录",
    });
  });

  it("does not outlaw the loop-back to 开发中 when a new dispatch exists", () => {
    const blocked = prdStatusOf("R1", [
      { requirement: "R1", kind: "verification", verdict: "FAIL" },
      DISPATCHED("R1"),
    ]);
    expect(blocked).toBe("开发中");
  });
});
