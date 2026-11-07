import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { SidePaneTab } from "../../../stores/side-pane-store.js";
import { useSidePaneStore } from "../../../stores/side-pane-store.js";
import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { ShellIcon } from "../icons.tsx";
import { shellCopy } from "../ui-copy.js";
import css from "../WorkspaceRail.module.css";

export type TabGlyph = Parameters<typeof ShellIcon>[0]["glyph"];

const TAB_GLYPHS: Record<SidePaneTab["kind"], TabGlyph> = {
  file: "code-brackets",
  diff: "dots",
  workspace: "folder",
  git: "branch",
  tasks: "clock",
  terminal: "terminal",
  subagent: "robot",
  directory: "robot",
  team: "cowork",
  automation: "clock",
};

export function TabIcon({ kind }: { kind: SidePaneTab["kind"] }) {
  return <ShellIcon glyph={TAB_GLYPHS[kind]} size={12} />;
}

/* ------------------------------------------------------------------ */
/* Context menu: the same three items ZCode's tab context menu offers. */
/* ------------------------------------------------------------------ */

interface MenuState {
  x: number;
  y: number;
  tabId: string;
}

function TabContextMenu({
  menu,
  canCloseOthers,
  onClose,
  onCloseOthers,
  onCloseAll,
}: {
  menu: MenuState;
  canCloseOthers: boolean;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu inside the viewport the way the reference does.
  const style: CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 190),
    top: Math.min(menu.y, window.innerHeight - 120),
  };

  return (
    <div ref={ref} className={css.tabMenu} style={style} role="menu">
      <button
        type="button"
        role="menuitem"
        className={css.tabMenuItem}
        onClick={onClose}
      >
        {copy.closeTabMenu}
      </button>
      <button
        type="button"
        role="menuitem"
        className={css.tabMenuItem}
        disabled={!canCloseOthers}
        onClick={onCloseOthers}
      >
        {copy.closeOtherTabsMenu}
      </button>
      <button
        type="button"
        role="menuitem"
        className={css.tabMenuItem}
        onClick={onCloseAll}
      >
        {copy.closeAllTabsMenu}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sortable tab trigger, ported from ZCode's SortableSidePaneTabTrigger. */
/* ------------------------------------------------------------------ */

function SortableTab({
  tab,
  isActive,
  onActivate,
  onContextMenu,
}: {
  tab: SidePaneTab;
  isActive: boolean;
  onActivate: () => void;
  onContextMenu: (menu: MenuState) => void;
}) {
  const closeTab = useSidePaneStore((state) => state.closeTab);
  const wasDraggingRef = useRef(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  // Horizontal tabs are a fixed-height control: dnd-kit carries scale in the
  // transform, so clamp it back to 1 to keep the tab from squashing.
  const normalizedTransform = transform
    ? { ...transform, scaleX: 1, scaleY: 1 }
    : null;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(normalizedTransform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };
  if (isDragging) wasDraggingRef.current = true;

  const showClose = isActive;

  return (
    // The close button inside must stay a real button, so this is a div with
    // role=tab, exactly why ZCode renders the trigger asChild onto a div.
    <div
      ref={setNodeRef}
      data-active={isActive}
      className={css.sidePaneTab}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event);
        event.preventDefault();
      }}
      onClick={(event) => {
        // Middle-click can dispatch both click and auxclick: intercept it in
        // click first so closing does not activate the tab.
        if (event.button === 1) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (wasDraggingRef.current) {
          wasDraggingRef.current = false;
          event.preventDefault();
          return;
        }
        onActivate();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        // Middle-click closes without the browser's default autoscroll.
        event.preventDefault();
        event.stopPropagation();
        closeTab(tab.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
      }}
    >
      <span className={css.sidePaneTabContent} data-close-visible={showClose}>
        <span className={css.sidePaneTabIcon}>
          <TabIcon kind={tab.kind} />
        </span>
        <span className={css.sidePaneTabTitle}>{tab.title}</span>
      </span>
      <button
        type="button"
        className={css.sidePaneTabClose}
        aria-label={`Close ${tab.title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeTab(tab.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

/** The floating tab that follows the pointer while one is being dragged. */
export function TabDragOverlay({ tab }: { tab: SidePaneTab }) {
  return (
    <div className={css.sidePaneTabOverlay}>
      <span className={css.sidePaneTabContent} data-close-visible="false">
        <span className={css.sidePaneTabIcon}>
          <TabIcon kind={tab.kind} />
        </span>
        <span className={css.sidePaneTabTitle}>{tab.title}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview: opens when the strip overflows, mirroring ZCode's          */
/* SidePaneTabOverview - searchable open tabs plus recently closed.     */
/* ------------------------------------------------------------------ */

export function TabOverviewButton({
  tabCount,
  openTabs,
  children,
}: {
  tabCount: number;
  openTabs: SidePaneTab[];
  children: ReactNode;
}) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const activeId = useSidePaneStore((state) => state.activeId);
  const recentClosed = useSidePaneStore((state) => state.recentClosed);
  const activateTab = useSidePaneStore((state) => state.activateTab);
  const closeTab = useSidePaneStore((state) => state.closeTab);
  const reopenClosedTab = useSidePaneStore((state) => state.reopenClosedTab);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [overflowing, setOverflowing] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // The button appears exactly when the strip cannot fit its tabs.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => setOverflowing(strip.scrollWidth > strip.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [tabCount]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const normalized = query.trim().toLowerCase();
  const matches = (title: string) =>
    normalized === "" || title.toLowerCase().includes(normalized);
  const openItems = openTabs.filter((tab) => matches(tab.title));
  const recentItems = recentClosed.filter(
    (tab) =>
      matches(tab.title) && !openTabs.some((entry) => entry.id === tab.id),
  );

  return (
    <>
      <div
        ref={stripRef}
        className={css.sidePaneTabStrip}
        data-overflowing={overflowing}
        role="tablist"
      >
        {children}
      </div>
      {overflowing || open ? (
        <div className={css.sidePaneOverviewAnchor}>
          <button
            type="button"
            className={css.sidePaneOverviewTrigger}
            aria-label={copy.tabOverview}
            title={copy.tabOverview}
            data-open={open}
            onClick={() => setOpen((value) => !value)}
          >
            ⌄
          </button>
          {open ? (
            <div ref={popRef} className={css.sidePaneOverview}>
              <input
                type="search"
                className={css.sidePaneOverviewSearch}
                placeholder={copy.tabOverviewSearch}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              <div className={css.sidePaneOverviewSection}>
                {copy.tabOverviewOpen}
              </div>
              {openItems.map((tab) => (
                <div
                  key={tab.id}
                  className={css.sidePaneOverviewRow}
                  data-active={tab.id === activeId}
                >
                  <button
                    type="button"
                    className={css.sidePaneOverviewActivate}
                    onClick={() => {
                      activateTab(tab.id);
                      setOpen(false);
                    }}
                  >
                    <TabIcon kind={tab.kind} />
                    <span className={css.sidePaneTabTitle}>{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    className={css.sidePaneTabClose}
                    aria-label={copy.closeNamedTab(tab.title)}
                    onClick={() => closeTab(tab.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {openItems.length === 0 ? (
                <div className={css.sidePaneOverviewEmpty}>
                  {copy.tabOverviewNoResults}
                </div>
              ) : null}
              {recentItems.length > 0 ? (
                <>
                  <div className={css.sidePaneOverviewSection}>
                    {copy.tabOverviewRecent}
                  </div>
                  {recentItems.map((tab) => (
                    <div key={tab.id} className={css.sidePaneOverviewRow}>
                      <button
                        type="button"
                        className={css.sidePaneOverviewActivate}
                        onClick={() => {
                          reopenClosedTab(tab.id);
                          setOpen(false);
                        }}
                      >
                        <TabIcon kind={tab.kind} />
                        <span className={css.sidePaneTabTitle}>
                          {tab.title}
                        </span>
                      </button>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The tab strip itself: dnd-kit sorting over the sortable triggers.    */
/* ------------------------------------------------------------------ */

export function SidePaneTabStrip({
  tabs,
  activeId,
}: {
  tabs: SidePaneTab[];
  activeId: string | null;
}) {
  const moveTab = useSidePaneStore((state) => state.moveTab);
  const activateTab = useSidePaneStore((state) => state.activateTab);
  const closeTab = useSidePaneStore((state) => state.closeTab);
  const closeOtherTabs = useSidePaneStore((state) => state.closeOtherTabs);
  const closeAllTabs = useSidePaneStore((state) => state.closeAllTabs);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // ZCode's sensors: a 4px drag threshold so a plain click still activates.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    moveTab(String(active.id), String(over.id));
  };
  const handleDragCancel = () => {
    setDraggingId(null);
  };

  const draggingTab = tabs.find((tab) => tab.id === draggingId) ?? null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={css.sidePaneTabStripRow}>
        <TabOverviewButton tabCount={tabs.length} openTabs={tabs}>
          <SortableContext
            items={tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeId}
                onActivate={() => activateTab(tab.id)}
                onContextMenu={setMenu}
              />
            ))}
          </SortableContext>
        </TabOverviewButton>
      </div>
      <DragOverlay>
        {draggingTab ? <TabDragOverlay tab={draggingTab} /> : null}
      </DragOverlay>
      {menu !== null ? (
        <TabContextMenu
          menu={menu}
          canCloseOthers={tabs.length > 1}
          onClose={() => setMenu(null)}
          onCloseOthers={() => {
            closeOtherTabs(menu.tabId);
            setMenu(null);
          }}
          onCloseAll={() => {
            closeAllTabs();
            setMenu(null);
          }}
        />
      ) : null}
    </DndContext>
  );
}
