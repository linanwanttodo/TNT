import { describe, expect, it } from "vitest";

import { ROOT_REALM, realmTree } from "../realm/realmTree.js";
import { currentRealmId, runInRealmScope } from "../realm/scope.js";
import { runInDispatchScope } from "../subagent/dispatchScope.js";

import { ServiceContainer } from "./ServiceContainer.js";

describe("ServiceContainer realm resolution", () => {
  it("inherits root services and keeps child overrides private", async () => {
    const container = new ServiceContainer();
    const child = realmTree.fork(ROOT_REALM);
    const sibling = realmTree.fork(ROOT_REALM);
    container.registerValue("realm-test-root", "root");

    expect(await container.get("realm-test-root")).toBe("root");
    await runInRealmScope(child, async () => {
      expect(await container.get("realm-test-root")).toBe("root");
      container.registerValue("realm-test-root", "child");
      container.registerValue("realm-test-private", "private");
      expect(await container.get("realm-test-root")).toBe("child");
      expect(await container.get("realm-test-private")).toBe("private");
    });

    expect(await container.get("realm-test-root")).toBe("root");
    expect(container.has("realm-test-private")).toBe(false);
    await runInRealmScope(sibling, async () => {
      expect(await container.get("realm-test-root")).toBe("root");
      expect(container.has("realm-test-private")).toBe(false);
    });
  });

  it("enters the delegated realm for the whole dispatch scope", async () => {
    const child = realmTree.fork(ROOT_REALM);
    await runInDispatchScope(
      { context: { realmId: child } as any, maxDelegationDepth: 1 },
      async () => {
        expect(currentRealmId()).toBe(child);
        await Promise.resolve();
        expect(currentRealmId()).toBe(child);
      },
    );
  });

  it("does not resolve a sibling realm's pending factory", async () => {
    const container = new ServiceContainer();
    const firstRealm = realmTree.fork(ROOT_REALM);
    const secondRealm = realmTree.fork(ROOT_REALM);
    let finishFirst!: (value: string) => void;
    let finishSecond!: (value: string) => void;
    runInRealmScope(firstRealm, () => {
      container.register(
        "realm-test-parallel",
        () =>
          new Promise<string>((resolve) => {
            finishFirst = resolve;
          }),
      );
    });
    runInRealmScope(secondRealm, () => {
      container.register(
        "realm-test-parallel",
        () =>
          new Promise<string>((resolve) => {
            finishSecond = resolve;
          }),
      );
    });

    const first = runInRealmScope(firstRealm, () =>
      container.get("realm-test-parallel"),
    );
    const second = runInRealmScope(secondRealm, () =>
      container.get("realm-test-parallel"),
    );
    await new Promise((resolve) => setImmediate(resolve));
    finishFirst("first");
    expect(await first).toBe("first");
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    finishSecond("second");
    expect(await second).toBe("second");
  });

  it("keeps service change events within realm visibility", async () => {
    const container = new ServiceContainer();
    const child = realmTree.fork(ROOT_REALM);
    const grandchild = realmTree.fork(child);
    const sibling = realmTree.fork(ROOT_REALM);
    const rootEvents: string[] = [];
    const childEvents: string[] = [];
    const grandchildEvents: string[] = [];
    const siblingEvents: string[] = [];
    container.on("realm-events:ready", (value: string) =>
      rootEvents.push(value),
    );
    runInRealmScope(child, () => {
      container.on("realm-events:ready", (value: string) =>
        childEvents.push(value),
      );
    });
    runInRealmScope(grandchild, () => {
      container.on("realm-events:ready", (value: string) =>
        grandchildEvents.push(value),
      );
    });
    runInRealmScope(sibling, () => {
      container.on("realm-events:ready", (value: string) =>
        siblingEvents.push(value),
      );
    });

    runInRealmScope(child, () =>
      container.registerValue("realm-events", "child"),
    );
    expect(rootEvents).toEqual([]);
    expect(childEvents).toEqual(["child"]);
    expect(grandchildEvents).toEqual(["child"]);
    expect(siblingEvents).toEqual([]);

    container.registerValue("realm-events", "root");
    expect(rootEvents).toEqual(["root"]);
    expect(childEvents).toEqual(["child", "root"]);
    expect(grandchildEvents).toEqual(["child", "root"]);
    expect(siblingEvents).toEqual(["root"]);
  });

  it("reloads dependents declared in the same realm", async () => {
    const container = new ServiceContainer();
    const child = realmTree.fork(ROOT_REALM);
    let dependencyLoads = 0;
    let dependentLoads = 0;
    runInRealmScope(child, () => {
      container.register("realm-reload-dependency", async () => {
        dependencyLoads += 1;
        return dependencyLoads;
      });
      container.register(
        "realm-reload-dependent",
        async () => {
          dependentLoads += 1;
          return container.get("realm-reload-dependency");
        },
        ["realm-reload-dependency"],
      );
    });

    expect(
      await runInRealmScope(child, () =>
        container.get("realm-reload-dependent"),
      ),
    ).toBe(1);
    expect(
      await runInRealmScope(child, () =>
        container.reload("realm-reload-dependency"),
      ),
    ).toBe(2);
    expect(dependencyLoads).toBe(2);
    expect(dependentLoads).toBe(2);
    expect(
      await runInRealmScope(child, () =>
        container.get("realm-reload-dependent"),
      ),
    ).toBe(2);
    expect(dependentLoads).toBe(2);
  });

  it("loads a scoped factory once per realm", async () => {
    const container = new ServiceContainer();
    const child = realmTree.fork(ROOT_REALM);
    let loads = 0;

    runInRealmScope(child, () => {
      container.register("realm-test-factory", async () => {
        loads += 1;
        return { child: true };
      });
    });

    const [first, second] = await Promise.all([
      runInRealmScope(child, () => container.get("realm-test-factory")),
      runInRealmScope(child, () => container.get("realm-test-factory")),
    ]);

    expect(first).toEqual({ child: true });
    expect(second).toBe(first);
    expect(loads).toBe(1);
    expect(container.has("realm-test-factory")).toBe(false);
  });
});
