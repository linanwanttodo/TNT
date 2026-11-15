import { vi } from "vitest";

export const logger: any = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn((): any => logger),
};
export const getLogPath = vi.fn(() => "/mock/log/path");
export const getSessionId = vi.fn(() => "mock-session-id");
export const resolveLogLevel = vi.fn(() => "info");
export const setLogLevel = vi.fn();
export const configureHeadlessMode = vi.fn();
export const flushTransports = vi.fn();
export const flushLogs = vi.fn<() => Promise<void>>(async () => {});
