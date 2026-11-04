import { describe, expect, it } from "vitest";

import {
  CLOSURE_STATUSES,
  closureStatusOf,
  requiresChangeRecord,
} from "./closure.js";

describe("the six-state closure vocabulary", () => {
  it("fixes the vocabulary to the design's six statuses", () => {
    expect([...CLOSURE_STATUSES]).toEqual([
      "progress",
      "waiting",
      "ready",
      "blocked",
      "failed",
      "dropped",
    ]);
  });

  it("reads the status word from the first line of a report", () => {
    expect(closureStatusOf("ready\nPRD 状态更新：R1 已实现")).toBe("ready");
    expect(closureStatusOf("progress：完成 R1，R2 进行中")).toBe("progress");
    // The Chinese alias of each state word counts as the same status.
    expect(closureStatusOf("受阻：缺部署授权")).toBe("blocked");
    expect(closureStatusOf("无需处理：需求与目标矛盾")).toBe("dropped");
  });

  it("rejects a report whose first line is not a status word", () => {
    expect(closureStatusOf("我做完了所有条目，测试都过了。")).toBeUndefined();
    expect(closureStatusOf("")).toBeUndefined();
    // The status word must lead; buried mid-report it does not close.
    expect(closureStatusOf("一些叙述\nready：这才轮到状态词")).toBeUndefined();
  });

  it("accepts a partial draft report as progress, never blocked", () => {
    const report = "progress\nR1、R2 完成，R3 剩余；下一轮继续 R3。";
    expect(closureStatusOf(report)).toBe("progress");
  });

  it("marks dropped as the only status that must leave a change record", () => {
    for (const status of CLOSURE_STATUSES) {
      expect(requiresChangeRecord(status)).toBe(status === "dropped");
    }
  });
});
