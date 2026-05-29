import { create } from "zustand";

/**
 * The right-hand side pane, ported from ZCode's app-shell side pane: it has
 * no fixed panels. Every view is a tab that appears when something is opened
 * - a file from the workspace tree, a diff from the git list, a terminal -
 * and clicking a row opens (or focuses) its tab. Tabs close individually;
 * activation follows the usual editor rules.
 */
export type SidePaneTabKind =
  | "file"
  | "diff"
  | "workspace"
  | "git"
  | "tasks"
  | "terminal"
  | "subagent"
  | "directory"
  | "team"
  | "automation";

export interface SidePaneTab {
  id: string;
  kind: SidePaneTabKind;
  title: string;
  /** file/diff: the absolute path the tab shows; subagent: the agent name. */
  path?: string | undefined;
}

interface SidePaneState {
  tabs: SidePaneTab[];
  activeId: string | null;
  /** Closed tabs, newest first, so the overview can reopen them. */
  recentClosed: SidePaneTab[];
  /** Open a tab for this content, or focus the existing equivalent. */
  openTab: (tab: Omit<SidePaneTab, "id"> & { id?: string }) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  /** Drag-and-drop reorder: move one tab to another tab's position. */
  moveTab: (draggedId: string, overId: string) => void;
  reopenClosedTab: (id: string) => void;
}

/** Tabs of the same kind targeting the same path are the same tab. */
function tabKey(kind: SidePaneTabKind, path: string | undefined): string {
  return path ? `${kind}:${path}` : kind;
}

/** Remember a closed tab, newest first, bounded like ZCode's overview. */
function rememberClosed(
  recent: SidePaneTab[],
  tab: SidePaneTab,
): SidePaneTab[] {
  const next = [tab, ...recent.filter((entry) => entry.id !== tab.id)];
  return next.slice(0, 10);
}

export const useSidePaneStore = create<SidePaneState>((set, get) => ({
  tabs: [],
  activeId: null,
  recentClosed: [],

  openTab: ({ id, kind, title, path }) => {
    const key = id ?? tabKey(kind, path);
    const existing = get().tabs.find((tab) => tab.id === key);
    if (existing) {
      set({
        activeId: key,
        // A reopened kind may carry a fresher title; keep it in step.
        tabs: get().tabs.map((tab) =>
          tab.id === key ? { ...tab, title, path } : tab,
        ),
      });
      return;
    }
    set({
      tabs: [...get().tabs, { id: key, kind, title, path }],
      activeId: key,
      recentClosed: get().recentClosed.filter((entry) => entry.id !== key),
    });
  },

  activateTab: (id) => set({ activeId: id }),

  closeTab: (id) => {
    const closed = get().tabs.find((tab) => tab.id === id);
    const tabs = get().tabs.filter((tab) => tab.id !== id);
    const { activeId } = get();
    if (activeId === id) {
      // Focus the neighbour the way an editor does: the tab to the right,
      // else the one to the left, else nothing.
      const closedIndex = get().tabs.findIndex((tab) => tab.id === id);
      const next = tabs[Math.min(closedIndex, tabs.length - 1)];
      set({
        tabs,
        activeId: next?.id ?? null,
        recentClosed: closed
          ? rememberClosed(get().recentClosed, closed)
          : get().recentClosed,
      });
    } else {
      set({
        tabs,
        recentClosed: closed
          ? rememberClosed(get().recentClosed, closed)
          : get().recentClosed,
      });
    }
  },

  closeOtherTabs: (id) =>
    set({
      recentClosed: [
        ...get()
          .tabs.filter((tab) => tab.id !== id)
          .reverse()
          .reduce(
            (recent, tab) => rememberClosed(recent, tab),
            get().recentClosed,
          ),
      ],
      tabs: get().tabs.filter((tab) => tab.id === id),
      activeId: id,
    }),

  closeAllTabs: () =>
    set({
      recentClosed: [...get().tabs]
        .reverse()
        .reduce(
          (recent, tab) => rememberClosed(recent, tab),
          get().recentClosed,
        ),
      tabs: [],
      activeId: null,
    }),

  moveTab: (draggedId, overId) => {
    if (draggedId === overId) return;
    const tabs = [...get().tabs];
    const from = tabs.findIndex((tab) => tab.id === draggedId);
    const to = tabs.findIndex((tab) => tab.id === overId);
    if (from === -1 || to === -1) return;
    tabs.splice(to, 0, ...tabs.splice(from, 1));
    set({ tabs });
  },

  reopenClosedTab: (id) => {
    const tab = get().recentClosed.find((entry) => entry.id === id);
    if (!tab) return;
    if (get().tabs.some((entry) => entry.id === id)) {
      set({ activeId: id });
      return;
    }
    set({
      tabs: [...get().tabs, tab],
      activeId: id,
      recentClosed: get().recentClosed.filter((entry) => entry.id !== id),
    });
  },
}));
