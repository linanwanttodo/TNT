import {
  IRemoteProjectService,
  type RemoteProjectDirectory,
} from "@zcode/services";

/**
 * TNT serves local workspaces only. The shell asks every host for its remote
 * project directory at startup; an empty directory is the truthful answer, not
 * a placeholder. The mutation calls reject because TNT has no remote target to
 * save, bind or refresh.
 */
export function createTntRemoteProjectService(): IRemoteProjectService {
  const unavailable = (operation: string): Promise<never> =>
    Promise.reject(
      new Error(`ZCODE_UNAVAILABLE: TNT has no remote projects (${operation})`),
    );
  return {
    readDirectory: async (): Promise<RemoteProjectDirectory> => ({
      hosts: [],
      entries: [],
    }),
    connectHost: () => unavailable("connectHost"),
    saveHost: () => unavailable("saveHost"),
    bindHost: () => unavailable("bindHost"),
    removeHost: () => unavailable("removeHost"),
    addEntry: () => unavailable("addEntry"),
    refreshEntry: () => unavailable("refreshEntry"),
    removeEntry: () => unavailable("removeEntry"),
  };
}
