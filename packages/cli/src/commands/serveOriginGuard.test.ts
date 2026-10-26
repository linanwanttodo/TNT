import { describe, expect, it, vi } from "vitest";

import { attachBrowserOriginGuard } from "./serve.helpers.js";

type Handler = (req: any, res: any, next: () => void) => void;

function install(boundHost?: string): {
  handler: Handler;
} {
  let handler: Handler = () => {};
  const app = {
    use: (fn: Handler) => {
      handler = fn;
    },
  } as any;
  attachBrowserOriginGuard(app, 4123, boundHost);
  return { handler };
}

function call(
  handler: Handler,
  headers: Record<string, string>,
): { forbidden: boolean; next: boolean } {
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: () => res,
  };
  const next = vi.fn();
  handler({ headers } as any, res as any, next);
  return {
    forbidden: res.statusCode === 403,
    next: next.mock.calls.length > 0,
  };
}

describe("the serve browser-origin guard", () => {
  it("lets a plain API client through", () => {
    const { handler } = install();
    expect(call(handler, {})).toEqual({ forbidden: false, next: true });
  });

  it("lets a loopback origin and host through", () => {
    const { handler } = install();
    expect(
      call(handler, {
        host: "127.0.0.1:4123",
        origin: "http://localhost:4123",
      }),
    ).toEqual({ forbidden: false, next: true });
  });

  it("rejects a cross-site origin before it reaches a handler", () => {
    const { handler } = install();
    expect(call(handler, { origin: "http://evil.example" })).toEqual({
      forbidden: true,
      next: false,
    });
  });

  it("rejects a rebound host on a loopback bind", () => {
    const { handler } = install();
    expect(call(handler, { host: "attacker.example:4123" })).toEqual({
      forbidden: true,
      next: false,
    });
  });

  it("relaxes the host check when the operator bound a real interface", () => {
    const { handler } = install("0.0.0.0");
    expect(call(handler, { host: "workspace.lan:4123" })).toEqual({
      forbidden: false,
      next: true,
    });
  });

  it("still rejects cross-site origins on an exposed bind", () => {
    const { handler } = install("0.0.0.0");
    expect(call(handler, { origin: "http://evil.example" })).toEqual({
      forbidden: true,
      next: false,
    });
  });
});
