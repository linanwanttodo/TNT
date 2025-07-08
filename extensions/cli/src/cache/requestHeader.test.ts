import { describe, expect, it } from "vitest";

import {
  canonicalHeader,
  foldRequestHeader,
  headerEquals,
  type RequestHeader,
} from "./requestHeader.js";

const base: RequestHeader = {
  model: "deepseek-chat",
  systemMessage: "base prompt",
  tools: [{ name: "Read" }],
  temperature: 0,
  mode: "agent",
};

describe("canonicalHeader", () => {
  it("normalizes an empty tool list to an absent field", () => {
    expect(canonicalHeader({ ...base, tools: [] })).toEqual(
      canonicalHeader({ ...base, tools: undefined }),
    );
  });

  it("keeps a non-empty tool list", () => {
    expect(canonicalHeader(base).tools).toEqual([{ name: "Read" }]);
  });

  it("drops undefined optional fields", () => {
    const canonical = canonicalHeader({
      model: "m",
      temperature: undefined,
    });
    expect("temperature" in canonical).toBe(false);
  });
});

describe("headerEquals", () => {
  it("is equal for an empty tool list and a missing one", () => {
    const result = headerEquals(
      { ...base, tools: [] },
      { ...base, tools: undefined },
    );
    expect(result).toEqual({ equal: true, differingFields: [] });
  });

  it("names the field that differs", () => {
    expect(headerEquals(base, { ...base, model: "other" })).toEqual({
      equal: false,
      differingFields: ["model"],
    });
  });

  it("detects a system prompt change", () => {
    expect(headerEquals(base, { ...base, systemMessage: "changed" })).toEqual({
      equal: false,
      differingFields: ["systemMessage"],
    });
  });

  it("detects a tool set change", () => {
    expect(headerEquals(base, { ...base, tools: [{ name: "Bash" }] })).toEqual({
      equal: false,
      differingFields: ["tools"],
    });
  });

  it("detects a tool reorder", () => {
    expect(
      headerEquals(base, {
        ...base,
        tools: [{ name: "Bash" }, { name: "Read" }],
      }).equal,
    ).toBe(false);
  });

  it("reports every differing field", () => {
    expect(
      headerEquals(base, {
        ...base,
        mode: "plan",
        maxTokens: 4096,
      }).differingFields.sort(),
    ).toEqual(["maxTokens", "mode"]);
  });

  it("is equal for the same header", () => {
    expect(headerEquals(base, base).equal).toBe(true);
  });
});

describe("foldRequestHeader", () => {
  it("lists the fields in a stable order", () => {
    expect(foldRequestHeader(base).fields).toEqual([
      "mode",
      "model",
      "systemMessage",
      "temperature",
      "tools",
    ]);
  });

  it("does not list fields that were never set", () => {
    expect(foldRequestHeader({ model: "m" }).fields).toEqual(["model"]);
  });

  it("produces the same key for headers that differ only in field order", () => {
    const a = foldRequestHeader(base);
    const b = foldRequestHeader({
      mode: base.mode,
      model: base.model,
      temperature: base.temperature,
      systemMessage: base.systemMessage,
      tools: base.tools,
    });
    expect(a.key).toBe(b.key);
  });

  it("produces different keys when the prompt differs", () => {
    const a = foldRequestHeader(base);
    const b = foldRequestHeader({ ...base, systemMessage: "other" });
    expect(a.key).not.toBe(b.key);
  });
});
