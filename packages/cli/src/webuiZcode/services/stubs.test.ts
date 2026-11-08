import { describe, expect, it, vi } from "vitest";

import { stubService } from "./stubs.js";

type InertDisposable = { dispose(): void };
type InertEvent = (listener: (value: unknown) => void) => InertDisposable;

interface FakeService {
  onDidThing: InertEvent;
  onDynamicThing: () => InertEvent;
  readThing(): Promise<unknown>;
  then?: unknown;
}

describe("stubService", () => {
  const stub = stubService<FakeService>("fake.channel");

  it("returns a disposable that never fires from event members", () => {
    const listener = vi.fn();
    const subscription = stub.onDidThing(listener);

    expect(typeof subscription.dispose).toBe("function");
    expect(listener).not.toHaveBeenCalled();
    subscription.dispose();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not expose a then method", () => {
    // Awaiting the proxy must not call a rejected "then" method.
    expect(stub.then).toBeUndefined();
  });

  it("returns the same inert event function from onDynamic members", () => {
    const listener = vi.fn();
    const event = stub.onDynamicThing();

    expect(typeof event).toBe("function");
    expect(event).toBe(stub.onDidThing);

    const subscription = event(listener);
    expect(typeof subscription.dispose).toBe("function");
    subscription.dispose();
    expect(listener).not.toHaveBeenCalled();
  });
});
