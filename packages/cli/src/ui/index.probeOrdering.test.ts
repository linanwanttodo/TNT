import { describe, expect, it, vi } from "vitest";

const { order, probeMock, renderMock } = vi.hoisted(() => {
  const order: string[] = [];
  const probeMock = vi.fn(async () => {
    order.push("probe");
    return true;
  });
  const renderMock = vi.fn(() => {
    order.push("render");
    return { unmount: vi.fn(), cleanup: vi.fn() };
  });
  return { order, probeMock, renderMock };
});

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return { ...actual, render: renderMock };
});

vi.mock("./AppRoot.js", () => ({ AppRoot: () => null }));

vi.mock("./theme/terminalAppearance.js", () => ({
  detectedTerminalIsDark: vi.fn(() => undefined),
  probeTerminalIsDark: probeMock,
  setDetectedTerminalIsDark: vi.fn(),
}));

vi.mock("./utils/terminalScreen.js", () => ({
  alternateScreenEnabled: () => false,
  enterAlternateScreen: vi.fn(),
  leaveAlternateScreen: vi.fn(),
}));

vi.mock("../index.js", () => ({
  enableSigintHandler: vi.fn(),
  setTUIUnmount: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  initializeServices: vi.fn(),
}));

vi.mock("../services/ServiceContainerContext.js", () => ({
  ServiceContainerProvider: () => null,
}));

vi.mock("../utils/cli.js", () => ({
  isHeadlessMode: () => false,
  isTTYless: () => false,
}));

import { startTUIChat } from "./index.js";

describe("startTUIChat theme probe ordering", () => {
  it("awaits the terminal probe before the first render", async () => {
    const stdin = {
      isTTY: true,
      isRaw: false,
      setRawMode: vi.fn(),
    } as unknown as NodeJS.ReadStream;

    await startTUIChat({ skipOnboarding: true, customStdin: stdin });

    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["probe", "render"]);
  });
});
