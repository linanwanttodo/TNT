import { AsyncLocalStorage } from "node:async_hooks";

import { ROOT_REALM, type RealmId } from "./realmTree.js";

const storage = new AsyncLocalStorage<RealmId>();

export function currentRealmId(): RealmId {
  return storage.getStore() ?? ROOT_REALM;
}

export function runInRealmScope<T>(realmId: RealmId, task: () => T): T {
  return storage.run(realmId, task);
}
