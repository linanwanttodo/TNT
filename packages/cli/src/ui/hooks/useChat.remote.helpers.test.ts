import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it, vi } from "vitest";

// 被测模块在顶层引入 services 容器；这里只测纯比较函数，替换掉容器。
vi.mock("../../services/index.js", () => ({
  services: {
    chatHistory: {
      isRemoteMode: () => true,
      setRemoteMode: () => undefined,
      getHistory: () => [],
      setHistory: () => undefined,
      addSystemMessage: () => undefined,
    },
  },
}));

import { historiesEqual } from "./useChat.remote.helpers.js";

function item(content: string): ChatHistoryItem {
  return { role: "user", content } as unknown as ChatHistoryItem;
}

/**
 * 远程轮询每 500ms 一次；比较必须廉价——长度加最后一条的 JSON 即可判定
 * 是否跳过 setState，避免每半秒全量 stringify 与全量重渲染。
 */
describe("historiesEqual", () => {
  it("treats a same-length history with the same tail as unchanged", () => {
    const current = [item("one"), item("two")];
    const next = [item("one"), item("two")];
    expect(historiesEqual(current, next)).toBe(true);
  });

  it("treats a different length as changed", () => {
    const current = [item("one")];
    const next = [item("one"), item("two")];
    expect(historiesEqual(current, next)).toBe(false);
  });

  it("treats a same-length history with a different tail as changed", () => {
    const current = [item("one"), item("two")];
    const next = [item("one"), item("changed")];
    expect(historiesEqual(current, next)).toBe(false);
  });

  it("treats two empty histories as unchanged", () => {
    expect(historiesEqual([], [])).toBe(true);
  });
});
