/**
 * RealmTree: the spatial isolation axis.
 *
 * A realm is a scope that can hold its own version of a service slot and its
 * own event listeners, layered over a parent realm. It is what lets two
 * delegated agents run in one process with different tools, a different
 * filesystem, or a different approval policy, without either of them knowing
 * the other exists.
 *
 * Visibility runs one way:
 *
 * - Lookup walks *up*: a child realm sees what it defines plus everything its
 *   ancestors define, and a parent sees nothing a child added.
 * - A policy installed at the root applies to every agent.
 * - Anything an agent installs stays with that agent; a subagent's restricted
 *   tool set must not leak up into its parent's next turn.
 *
 * Both the service table and the event bus resolve through this same tree, so
 * "scoped to this agent" means the same thing for a service and for a listener.
 */

export type RealmId = number;

import { t } from "../i18n/index.js";

/** The realm every context starts in. */
export const ROOT_REALM: RealmId = 0;

export class RealmTree {
  private parents: Map<RealmId, RealmId>;
  private nextId: number;

  constructor() {
    this.parents = new Map([[ROOT_REALM, -1]]);
    this.nextId = 1;
  }

  /**
   * Fork a new child realm from `parent`. The child inherits everything its
   * ancestors define, but anything it installs stays private to its subtree.
   */
  fork(parent: RealmId): RealmId {
    if (!this.parents.has(parent)) {
      throw new Error(t("realm.unknownParent", { realm: parent }));
    }
    const id = this.nextId++;
    this.parents.set(id, parent);
    return id;
  }

  /** Return the immediate parent of `realm`, or undefined if none. */
  parentOf(realm: RealmId): RealmId | undefined {
    const p = this.parents.get(realm);
    if (p === undefined || p === -1) return undefined;
    return p;
  }

  /**
   * `realm` and every ancestor, nearest first.
   */
  ancestry(realm: RealmId): RealmId[] {
    const chain: RealmId[] = [realm];
    let current: RealmId | undefined = realm;
    while (true) {
      const parent = this.parentOf(current!);
      if (parent === undefined) break;
      if (chain.includes(parent)) break;
      chain.push(parent);
      current = parent;
    }
    return chain;
  }

  /**
   * Is something registered in `owner` visible to work happening in `viewer`?
   *
   * True when `owner === viewer`, `owner === ROOT_REALM`, or `owner` is an
   * ancestor of `viewer`. The one-way rule this module exists to enforce.
   */
  visibleFrom(owner: RealmId, viewer: RealmId): boolean {
    if (owner === viewer || owner === ROOT_REALM) return true;
    return this.ancestry(viewer).includes(owner);
  }
}

/** Process-wide singleton realm tree. */
export const realmTree = new RealmTree();
