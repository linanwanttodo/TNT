/**
 * Realm-aware ServiceTable.
 *
 * Wraps a RealmTree and adds per-realm slot resolution.
 * A service provided in a child realm shadows the same key from ancestors.
 * Lookup walks up the realm ancestry chain.
 */

import { EventEmitter } from "events";

import { t } from "../i18n/index.js";

import { RealmTree, type RealmId, realmTree } from "./realmTree.js";

interface RealmSlot {
  realm: RealmId;
  value: unknown;
  owner: string;
}

type ServiceKey = string;

export class ServiceTable extends EventEmitter {
  private readonly realmTree: RealmTree;
  private slots = new Map<ServiceKey, Map<RealmId, RealmSlot>>();
  private cache = new Map<string, Map<RealmId, unknown>>();

  constructor(tree: RealmTree = new RealmTree()) {
    super();
    this.setMaxListeners(100);
    this.realmTree = tree;
  }

  getRealmTree(): RealmTree {
    return this.realmTree;
  }

  provide(
    key: ServiceKey,
    realm: RealmId,
    value: unknown,
    owner: string,
  ): void {
    let realmMap = this.slots.get(key);
    if (!realmMap) {
      realmMap = new Map();
      this.slots.set(key, realmMap);
    }
    if (realmMap.has(realm)) {
      const existing = realmMap.get(realm)!;
      throw new Error(
        t("realm.serviceConflict", {
          key,
          realm,
          owner: existing.owner,
        }),
      );
    }
    realmMap.set(realm, { realm, value, owner });
    this.invalidateCache(key);
    this.emit(`${key}:provided`, { key, realm, value, owner });
  }

  set(key: ServiceKey, realm: RealmId, value: unknown, owner: string): void {
    let realmMap = this.slots.get(key);
    if (!realmMap) {
      realmMap = new Map();
      this.slots.set(key, realmMap);
    }
    realmMap.set(realm, { realm, value, owner });
    this.invalidateCache(key);
    this.emit(`${key}:provided`, { key, realm, value, owner });
  }

  get<T>(key: ServiceKey, viewerRealm: RealmId): T | undefined {
    const cached = this.cache.get(key)?.get(viewerRealm);
    if (cached !== undefined) {
      return cached as T;
    }
    const ancestry = this.realmTree.ancestry(viewerRealm);
    const realmMap = this.slots.get(key);
    if (!realmMap) {
      this.setCache(key, viewerRealm, undefined);
      return undefined;
    }
    for (const r of ancestry) {
      const slot = realmMap.get(r);
      if (slot) {
        this.setCache(key, viewerRealm, slot.value);
        return slot.value as T;
      }
    }
    this.setCache(key, viewerRealm, undefined);
    return undefined;
  }

  has(key: ServiceKey, viewerRealm: RealmId): boolean {
    return this.get(key, viewerRealm) !== undefined;
  }

  getLocal<T>(key: ServiceKey, realm: RealmId): T | undefined {
    return this.slots.get(key)?.get(realm)?.value as T | undefined;
  }

  revoke(key: ServiceKey, realm: RealmId, owner: string): boolean {
    const realmMap = this.slots.get(key);
    if (!realmMap) return false;
    const slot = realmMap.get(realm);
    if (!slot || slot.owner !== owner) return false;
    realmMap.delete(realm);
    this.invalidateCache(key);
    this.emit(`${key}:revoked`, { key, realm });
    return true;
  }

  private invalidateCache(key: ServiceKey): void {
    this.cache.delete(key);
  }

  private setCache(key: ServiceKey, realm: RealmId, value: unknown): void {
    let keyCache = this.cache.get(key);
    if (!keyCache) {
      keyCache = new Map();
      this.cache.set(key, keyCache);
    }
    keyCache.set(realm, value);
  }

  list(key: ServiceKey): Array<{ realm: RealmId; owner: string }> {
    const realmMap = this.slots.get(key);
    if (!realmMap) return [];
    return Array.from(realmMap.entries()).map(([realm, slot]) => ({
      realm,
      owner: slot.owner,
    }));
  }

  listVisible(
    viewerRealm: RealmId,
  ): Array<{ key: ServiceKey; realm: RealmId; owner: string }> {
    const result: Array<{ key: ServiceKey; realm: RealmId; owner: string }> =
      [];
    const keys = Array.from(this.slots.keys());
    for (const key of keys) {
      const ancestry = this.realmTree.ancestry(viewerRealm);
      for (const r of ancestry) {
        const realmMap = this.slots.get(key);
        if (!realmMap) continue;
        const slot = realmMap.get(r);
        if (slot) {
          result.push({ key, realm: r, owner: slot.owner });
          break;
        }
      }
    }
    return result;
  }
}

export const serviceTable = new ServiceTable(realmTree);
