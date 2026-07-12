import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeMinimalConfig } from "../../test-utils/minimalConfig.js";

/**
 * The shared lazy initialization the serve daemon and the app-server turn path
 * use. Each test resets the module registry so the dedup promise and the
 * service container singleton start fresh, the way a new process does.
 */
describe("ensureServicesInitialized", () => {
  let mod: typeof import("./index.js");

  beforeEach(async () => {
    vi.resetModules();
    writeMinimalConfig();
    mod = await import("./index.js");
  });

  it("brings the registry up when the model service is not registered", async () => {
    expect(mod.serviceContainer.isReady(mod.SERVICE_NAMES.MODEL)).toBe(false);

    await mod.ensureServicesInitialized({ headless: true });

    const model = mod.serviceContainer.getSync<
      import("./types.js").ModelServiceState
    >(mod.SERVICE_NAMES.MODEL);
    expect(model.state).toBe("ready");
    expect(model.value?.model?.model).toBe("gpt-4");
    expect(model.value?.llmApi).toBeDefined();
  });

  it("does not re-run initialization once the model is ready", async () => {
    await mod.ensureServicesInitialized({ headless: true });
    const initialize = vi.spyOn(mod.services.config, "initialize");

    await mod.ensureServicesInitialized({ headless: true });

    expect(initialize).not.toHaveBeenCalled();
  });

  it("concurrent callers share a single initialization", async () => {
    const initialize = vi.spyOn(mod.services.config, "initialize");

    await Promise.all([
      mod.ensureServicesInitialized({ headless: true }),
      mod.ensureServicesInitialized({ headless: true }),
      mod.ensureServicesInitialized({ headless: true }),
    ]);

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(mod.serviceContainer.isReady(mod.SERVICE_NAMES.MODEL)).toBe(true);
  });

  it("allows a retry after the initialization itself throws", async () => {
    const register = vi
      .spyOn(mod.serviceContainer, "register")
      .mockImplementationOnce(() => {
        throw new Error("registry unavailable");
      });

    await expect(
      mod.ensureServicesInitialized({ headless: true }),
    ).rejects.toThrow("registry unavailable");
    register.mockRestore();

    await mod.ensureServicesInitialized({ headless: true });

    expect(mod.serviceContainer.isReady(mod.SERVICE_NAMES.MODEL)).toBe(true);
  });
});
