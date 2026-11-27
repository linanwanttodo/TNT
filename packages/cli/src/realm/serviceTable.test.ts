import { describe, expect, it } from "vitest";

import { ROOT_REALM, RealmTree } from "./realmTree.js";
import { ServiceTable } from "./serviceTable.js";

describe("ServiceTable", () => {
  it("uses the same realm tree as the runtime that created the child", () => {
    const tree = new RealmTree();
    const child = tree.fork(ROOT_REALM);
    const table = new ServiceTable(tree);
    const value = { read: () => "shared" };
    table.provide("fs", ROOT_REALM, value, "root");

    expect(table.getRealmTree()).toBe(tree);
    expect(table.get("fs", child)).toBe(value);
  });

  it("provides and gets a service in the root realm", () => {
    const table = new ServiceTable();
    const value = { read: () => "data" };
    table.provide("fs", ROOT_REALM, value, "root-provider");
    expect(table.get("fs", ROOT_REALM)).toBe(value);
  });

  it("child realm sees parent's service", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    table.provide("config", root, { theme: "dark" }, "root-provider");
    const child = table.getRealmTree().fork(root);
    expect(table.get("config", child)).toEqual({ theme: "dark" });
  });

  it("child realm shadows parent's service", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    table.provide("config", root, { theme: "dark" }, "root-provider");
    const child = table.getRealmTree().fork(root);
    table.provide("config", child, { theme: "light" }, "child-provider");
    expect(table.get("config", child)).toEqual({ theme: "light" });
    // Parent still sees its own value.
    expect(table.get("config", root)).toEqual({ theme: "dark" });
  });

  it("parent does NOT see child's service", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    const child = table.getRealmTree().fork(root);
    table.provide("tool", child, { name: "private-tool" }, "child-provider");
    expect(table.get("tool", root)).toBeUndefined();
  });

  it("returns undefined when no service exists", () => {
    const table = new ServiceTable();
    expect(table.get("nonexistent", ROOT_REALM)).toBeUndefined();
  });

  it("revoke removes a service from a realm", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    const child = table.getRealmTree().fork(root);
    table.provide("tool", child, { name: "x" }, "owner");
    expect(table.get("tool", child)).toEqual({ name: "x" });
    const revoked = table.revoke("tool", child, "owner");
    expect(revoked).toBe(true);
    expect(table.get("tool", child)).toBeUndefined();
  });

  it("revoke rejects wrong owner", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    const child = table.getRealmTree().fork(root);
    table.provide("tool", child, { name: "x" }, "owner-a");
    expect(table.revoke("tool", child, "owner-b")).toBe(false);
    expect(table.get("tool", child)).toEqual({ name: "x" });
  });

  it("has returns true for visible services", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    table.provide("x", root, 1, "root");
    const child = table.getRealmTree().fork(root);
    expect(table.has("x", child)).toBe(true);
    expect(table.has("y", child)).toBe(false);
  });

  it("listVisible returns nearest ancestor's service", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    const child = table.getRealmTree().fork(root);
    table.provide("shared", root, { v: 1 }, "root");
    table.provide("shared", child, { v: 2 }, "child");
    const visible = table.listVisible(child);
    const shared = visible.find((s) => s.key === "shared");
    expect(shared?.realm).toBe(child);
    expect(shared?.owner).toBe("child");
  });

  it("listVisible includes ancestor-only services", () => {
    const table = new ServiceTable();
    const root = ROOT_REALM;
    table.provide("only-root", root, { v: 1 }, "root");
    const child = table.getRealmTree().fork(root);
    const visible = table.listVisible(child);
    expect(visible.find((s) => s.key === "only-root")).toBeDefined();
  });
});
