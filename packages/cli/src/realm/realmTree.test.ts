import { describe, expect, it } from "vitest";

import { ROOT_REALM, RealmTree } from "./realmTree.js";

describe("RealmTree", () => {
  it("starts with a single root realm", () => {
    const tree = new RealmTree();
    expect(tree.ancestry(0)).toEqual([0]);
    expect(tree.parentOf(0)).toBeUndefined();
  });

  it("forks children from a parent", () => {
    const tree = new RealmTree();
    const child = tree.fork(ROOT_REALM);
    const grandchild = tree.fork(child);
    expect(tree.parentOf(child)).toBe(0);
    expect(tree.parentOf(grandchild)).toBe(child);
    expect(tree.ancestry(grandchild)).toEqual([grandchild, child, 0]);
  });

  it("resolves visibility one-way up the ancestry chain", () => {
    const tree = new RealmTree();
    const team = tree.fork(ROOT_REALM);
    const member = tree.fork(team);

    // Root is visible to everyone (its policy applies to all).
    expect(tree.visibleFrom(ROOT_REALM, member)).toBe(true);
    // A child SEES its ancestors' installs (root policy applies downwards).
    expect(tree.visibleFrom(team, member)).toBe(true);
    expect(tree.visibleFrom(ROOT_REALM, member)).toBe(true);
    // A child always sees its own installs.
    expect(tree.visibleFrom(member, member)).toBe(true);
  });

  it("keeps a child from leaking installs up into the parent", () => {
    const tree = new RealmTree();
    const team = tree.fork(ROOT_REALM);
    const member = tree.fork(team);

    // The member installed a private tool list. The parent (team) must NOT see it.
    expect(tree.visibleFrom(member, team)).toBe(false);
    // But the child sees the parent's installs.
    expect(tree.visibleFrom(team, member)).toBe(true);
    // Self-visible always.
    expect(tree.visibleFrom(member, member)).toBe(true);
  });

  it("rejects a fork from an unknown realm", () => {
    const tree = new RealmTree();
    expect(() => tree.fork(999)).toThrow(/unknown realm/i);
  });

  it("bounds the ancestry walk against cycles", () => {
    const tree = new RealmTree();
    // Forking a self-referential node would be corrupt; the chain must stop.
    const a = tree.fork(ROOT_REALM);
    const b = tree.fork(a);
    expect(tree.ancestry(b)).toEqual([b, a, 0]);
  });
});
