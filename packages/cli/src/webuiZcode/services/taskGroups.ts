import { ITaskGroupService, type TaskGroupStructure } from "@zcode/services";

const UNAVAILABLE = "ZCODE_UNAVAILABLE";

/**
 * TNT stores no task groups, so the true structure is "no groups, every task
 * ungrouped". The shell still asks: the grouped sidebar reads the structure,
 * and a first send settles its placement. An ungrouped placement therefore
 * succeeds - that is the actual state - while naming a group, creating one or
 * reordering rejects instead of reporting a write that did not happen.
 */
export function createTntTaskGroupService(): ITaskGroupService {
  return {
    async read(): Promise<TaskGroupStructure> {
      return { groups: [], members: [], order: [] };
    },
    async admit(input) {
      const groupId = input.placement?.groupId ?? null;
      if (groupId !== null) {
        throw new Error(`${UNAVAILABLE}: no such task group: ${groupId}`);
      }
    },
    save() {
      return Promise.reject(
        new Error(`${UNAVAILABLE}: TNT stores no task groups (save)`),
      );
    },
    ungroup() {
      return Promise.reject(
        new Error(`${UNAVAILABLE}: TNT stores no task groups (ungroup)`),
      );
    },
    move() {
      return Promise.reject(
        new Error(`${UNAVAILABLE}: TNT stores no task groups (move)`),
      );
    },
  };
}
