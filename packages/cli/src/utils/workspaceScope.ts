import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

export function workspaceRoot(): string {
  return storage.getStore() ?? process.cwd();
}

export function runInWorkspaceScope<T>(root: string, task: () => T): T {
  return storage.run(root, task);
}
