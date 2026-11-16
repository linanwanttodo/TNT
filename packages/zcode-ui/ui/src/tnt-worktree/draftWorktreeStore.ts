import { create } from "zustand";

/**
 * Draft worktree state (docs/git/worktree.md §3.2, TNT v1).
 *
 * The composer header above the input box carries a worktree checkbox; when it
 * is on, the first send creates a managed worktree and the session runs there
 * instead of the project directory. The state belongs to the draft, not to the
 * session - a pane's checkbox never affects another pane's send.
 */

export interface DraftWorktreeState {
  enabled: boolean;
  /** Checkout ref; absent means the current HEAD (detached). */
  ref?: string;
}

interface DraftWorktreeStoreState {
  byWorkspaceKey: Record<string, DraftWorktreeState>;
  setEnabled(workspaceKey: string, enabled: boolean): void;
  setRef(workspaceKey: string, ref: string | undefined): void;
  read(workspaceKey: string): DraftWorktreeState;
}

export const useTntDraftWorktreeStore = create<DraftWorktreeStoreState>(
  (set, get) => ({
    byWorkspaceKey: {},
    setEnabled: (workspaceKey, enabled) =>
      set((state) => ({
        byWorkspaceKey: {
          ...state.byWorkspaceKey,
          [workspaceKey]: { ...state.byWorkspaceKey[workspaceKey], enabled },
        },
      })),
    setRef: (workspaceKey, ref) =>
      set((state) => {
        const current = state.byWorkspaceKey[workspaceKey];
        return {
          byWorkspaceKey: {
            ...state.byWorkspaceKey,
            [workspaceKey]: {
              enabled: current?.enabled ?? false,
              ...(ref === undefined ? {} : { ref }),
            },
          },
        };
      }),
    read: (workspaceKey) => get().byWorkspaceKey[workspaceKey] ?? { enabled: false },
  }),
);

/** Read outside React: the send path checks this once per submission. */
export function readTntDraftWorktreeState(
  workspaceKey: string,
): DraftWorktreeState {
  return useTntDraftWorktreeStore.getState().read(workspaceKey);
}

/** Test seam. */
export function resetTntDraftWorktreeStoreForTests(): void {
  useTntDraftWorktreeStore.setState({ byWorkspaceKey: {} });
}
