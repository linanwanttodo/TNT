import { describe, expect, it } from "vitest";
import type { ZCodeWorkflowRunSummary } from "@zcode/shared";
import {
  DEFAULT_WORKFLOW_RUN_STATUS_FILTER,
  WORKFLOW_RUN_STATUS_FILTERS,
  filterWorkflowRunsByStatus,
  hasWorkflowRunOpenSessionEntry,
  resolveWorkflowRunStatusFilterKind,
} from "./workflowRunsStatusFilter.js";
import { formatWorkflowTimestamp } from "../../lib/workflowObservationFormat.js";

function run(
  overrides: Partial<ZCodeWorkflowRunSummary> &
    Pick<ZCodeWorkflowRunSummary, "status" | "resumable">,
): ZCodeWorkflowRunSummary {
  return {
    runId: "run-1",
    sessionId: "session-1",
    sessionTitle: "会话标题",
    label: "team · 目标 · 成员",
    updatedAt: 0,
    ...overrides,
  };
}

describe("workflowRunsStatusFilter 五态归纳", () => {
  it("pending/running 归运行，errored 归失败，stopped 单独，completed 归完成", () => {
    expect(resolveWorkflowRunStatusFilterKind({ status: "pending" })).toBe("running");
    expect(resolveWorkflowRunStatusFilterKind({ status: "running" })).toBe("running");
    expect(resolveWorkflowRunStatusFilterKind({ status: "completed" })).toBe("completed");
    expect(resolveWorkflowRunStatusFilterKind({ status: "errored" })).toBe("failed");
    expect(resolveWorkflowRunStatusFilterKind({ status: "stopped" })).toBe("stopped");
  });

  it("默认筛选为全部，筛选项共五个", () => {
    expect(DEFAULT_WORKFLOW_RUN_STATUS_FILTER).toBe("all");
    expect(WORKFLOW_RUN_STATUS_FILTERS).toEqual([
      "all",
      "running",
      "completed",
      "failed",
      "stopped",
    ]);
  });

  it("filterWorkflowRunsByStatus 按组过滤，all 原样返回", () => {
    const runs = [
      run({ status: "pending", resumable: false }),
      run({ status: "running", resumable: false }),
      run({ status: "completed", resumable: false }),
      run({ status: "errored", resumable: true, failureMessage: "boom" }),
      run({ status: "stopped", resumable: true }),
    ];
    expect(filterWorkflowRunsByStatus(runs, "all")).toBe(runs);
    expect(filterWorkflowRunsByStatus(runs, "running").map((item) => item.status)).toEqual([
      "pending",
      "running",
    ]);
    expect(filterWorkflowRunsByStatus(runs, "completed").map((item) => item.status)).toEqual([
      "completed",
    ]);
    expect(filterWorkflowRunsByStatus(runs, "failed").map((item) => item.status)).toEqual([
      "errored",
    ]);
    expect(filterWorkflowRunsByStatus(runs, "stopped").map((item) => item.status)).toEqual([
      "stopped",
    ]);
  });
});

describe("workflowRunsStatusFilter 打开会话入口", () => {
  it("失败/停止且 resumable=true 才有入口", () => {
    expect(hasWorkflowRunOpenSessionEntry({ status: "errored", resumable: true })).toBe(true);
    expect(hasWorkflowRunOpenSessionEntry({ status: "stopped", resumable: true })).toBe(true);
    expect(hasWorkflowRunOpenSessionEntry({ status: "completed", resumable: true })).toBe(false);
    expect(hasWorkflowRunOpenSessionEntry({ status: "running", resumable: true })).toBe(false);
    expect(hasWorkflowRunOpenSessionEntry({ status: "pending", resumable: true })).toBe(false);
  });

  it("resumable=false 一律没有入口（无合成值）", () => {
    expect(hasWorkflowRunOpenSessionEntry({ status: "errored", resumable: false })).toBe(false);
    expect(hasWorkflowRunOpenSessionEntry({ status: "stopped", resumable: false })).toBe(false);
  });
});

describe("formatWorkflowTimestamp", () => {
  const options: Intl.DateTimeFormatOptions = {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  const ts = Date.UTC(2026, 0, 2, 3, 4, 0);

  it("locale 决定输出格式", () => {
    expect(formatWorkflowTimestamp(ts, "en-US")).toBe(
      new Intl.DateTimeFormat("en-US", options).format(new Date(ts)),
    );
  });

  it("locale 缺省走运行环境默认", () => {
    expect(formatWorkflowTimestamp(ts)).toBe(
      new Intl.DateTimeFormat(undefined, options).format(new Date(ts)),
    );
  });

  it("非法时间戳原样返回", () => {
    expect(formatWorkflowTimestamp(Number.NaN)).toBe("NaN");
    expect(formatWorkflowTimestamp(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
