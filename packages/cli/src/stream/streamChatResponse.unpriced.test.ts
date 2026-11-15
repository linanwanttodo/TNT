import { Usage } from "core/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  recordTokenUsage: vi.fn(),
  recordCost: vi.fn(),
  recordResponseTime: vi.fn(),
  logApiRequest: vi.fn(),
  logToolResult: vi.fn(),
}));
vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: telemetry,
}));

import { getSessionUsage, startNewSession } from "../session/index.js";

import { recordStreamTelemetry } from "./streamChatResponse.helpers.js";

const usage: Usage = { promptTokens: 1_000, completionTokens: 100 };

const model = (name: string) => ({
  provider: "openai",
  model: name,
  name,
  defaultCompletionOptions: {},
});

/**
 * A model nobody priced used to be billed at a made-up $1/$2 per MTok, so the
 * session total showed a number that looked measured. Unknown is not zero and not
 * an estimate: the request contributes nothing to the total and is counted, so the
 * line in the status bar can say what is missing from it.
 */
describe("a request whose model has no price", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startNewSession();
  });

  it("adds nothing invented to the total and counts the request", () => {
    const cost = recordStreamTelemetry({
      requestStartTime: Date.now() - 10,
      responseEndTime: Date.now(),
      inputTokens: 1_000,
      outputTokens: 100,
      model: model("a-model-nobody-priced"),
      fullUsage: {
        prompt_tokens: 1_000,
        completion_tokens: 100,
        total_tokens: 1_100,
      },
    });

    expect(cost).toBe(0);
    expect(getSessionUsage().totalCost).toBe(0);
    expect(getSessionUsage().unpricedRequests).toBe(1);
    // Nothing was reported as a cost either: a zero there is a claim about money.
    expect(telemetry.recordCost).not.toHaveBeenCalled();
  });

  it("leaves a priced model exactly as it was", () => {
    const cost = recordStreamTelemetry({
      requestStartTime: Date.now() - 10,
      responseEndTime: Date.now(),
      inputTokens: 1_000,
      outputTokens: 100,
      model: model("gpt-4o"),
      fullUsage: {
        prompt_tokens: 1_000,
        completion_tokens: 100,
        total_tokens: 1_100,
      },
    });

    expect(cost).toBeGreaterThan(0);
    expect(getSessionUsage().totalCost).toBeGreaterThan(0);
    expect(getSessionUsage().unpricedRequests ?? 0).toBe(0);
    expect(telemetry.recordCost).toHaveBeenCalledWith(cost, "gpt-4o");
  });

  it("keeps the estimate for a request whose usage never arrived", () => {
    // No usage at all is a different case: the tokens were counted locally, and
    // an estimate is the only thing left. It is not a model price, and it is not
    // counted as unpriced either.
    const cost = recordStreamTelemetry({
      requestStartTime: Date.now() - 10,
      responseEndTime: Date.now(),
      inputTokens: 1_000,
      outputTokens: 100,
      model: model("a-model-nobody-priced"),
    });

    expect(cost).toBeGreaterThan(0);
    expect(getSessionUsage().unpricedRequests ?? 0).toBe(0);
  });

  it("counts each unpriced request separately", () => {
    for (let i = 0; i < 3; i++) {
      recordStreamTelemetry({
        requestStartTime: Date.now() - 10,
        responseEndTime: Date.now(),
        inputTokens: 1_000,
        outputTokens: 100,
        model: model("a-model-nobody-priced"),
        fullUsage: {
          prompt_tokens: 1_000,
          completion_tokens: 100,
          total_tokens: 1_100,
        },
      });
    }

    expect(getSessionUsage().unpricedRequests).toBe(3);
    expect(getSessionUsage().totalCost).toBe(0);
  });

  it("still counts the tokens it did use", () => {
    recordStreamTelemetry({
      requestStartTime: Date.now() - 10,
      responseEndTime: Date.now(),
      inputTokens: 1_000,
      outputTokens: 100,
      model: model("a-model-nobody-priced"),
      fullUsage: {
        prompt_tokens: 1_000,
        completion_tokens: 100,
        total_tokens: 1_100,
      },
    });

    // The price is unknown; the usage is not.
    expect(getSessionUsage().promptTokens).toBe(1_000);
    expect(getSessionUsage().completionTokens).toBe(100);
  });
});
