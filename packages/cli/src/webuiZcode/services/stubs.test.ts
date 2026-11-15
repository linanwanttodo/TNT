import { IBroadcastService, ISettingService } from "@zcode/services";
import { DEFAULT_LOCALE } from "@zcode/shared";
import { describe, expect, it, vi } from "vitest";

import {
  ZCODE_UNAVAILABLE_PREFIX,
  stubBroadcastService,
  stubService,
  stubSettingService,
} from "./stubs.js";

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

describe("resolving service stubs", () => {
  it("resolves the AppSettings defaults from settingService.get", async () => {
    await expect(stubSettingService().get()).resolves.toEqual({
      recentProjects: [],
      locale: DEFAULT_LOCALE,
    });
  });

  it("still rejects setting writes with the channel code", async () => {
    await expect(
      stubSettingService().update({ locale: "en-US" }),
    ).rejects.toThrow(
      `${ZCODE_UNAVAILABLE_PREFIX}${ISettingService.channelName}`,
    );
  });

  it("resolves broadcastService.send while claims stay unavailable", async () => {
    const service = stubBroadcastService();

    await expect(
      service.send({ channel: "state:locale", payload: "en-US" }),
    ).resolves.toBeUndefined();
    await expect(service.acquireClaim("key")).rejects.toThrow(
      `${ZCODE_UNAVAILABLE_PREFIX}${IBroadcastService.channelName}`,
    );
  });

  it("keeps broadcastService.onMessage inert", () => {
    const listener = vi.fn();
    const subscription = stubBroadcastService().onMessage(listener);

    expect(typeof subscription.dispose).toBe("function");
    subscription.dispose();
    expect(listener).not.toHaveBeenCalled();
  });
});
