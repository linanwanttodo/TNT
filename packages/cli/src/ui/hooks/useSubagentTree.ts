import { useEffect, useRef, useState } from "react";

import { subscribeAgentEvents } from "../../protocol/eventBus.js";
import type { AgentEvent } from "../../protocol/events.js";
import {
  getCurrentSessionId,
  listSubagentSessions,
  loadSessionById,
} from "../../session/index.js";
import type { SubagentTreeEntry } from "../subagentTree.js";
import { deriveSubagentUsage } from "../subagentTree.js";

/** The open session, or undefined before the first one exists. */
export function currentSessionIdSafe(): string | undefined {
  try {
    return getCurrentSessionId();
  } catch {
    return undefined;
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

export interface UseSubagentTreeOptions {
  /**
   * Session whose delegated runs the tree follows. Subagent lifecycle events
   * carry this id, so a web UI turn in the same process cannot bleed into the
   * TUI's tree.
   */
  parentSessionId?: string;
}

/**
 * Read-only selector over the agent event bus. It keeps the live lifecycle of
 * delegated runs (started, finished, failed) and fills each finished row's
 * tool/token counters from the child transcript the executor saved before it
 * announced the finish.
 *
 * It reads existing surfaces only: the event bus and the session store. No
 * service or session-store field was added for this view.
 */
export function useSubagentTree(
  options: UseSubagentTreeOptions = {},
): SubagentTreeEntry[] {
  const { parentSessionId } = options;
  const [entries, setEntries] = useState<SubagentTreeEntry[]>([]);
  const parentRef = useRef(parentSessionId);
  parentRef.current = parentSessionId;

  useEffect(() => {
    let counter = 0;
    let cancelled = false;
    const runningByType = new Map<string, string[]>();
    const childIdsAtStart = new Map<string, Set<string>>();
    const claimedChildren = new Set<string>();

    const resolveParent = () => parentRef.current ?? currentSessionIdSafe();
    const matchesSession = (event: AgentEvent): boolean => {
      const parent = resolveParent();
      return parent === undefined || event.sessionId === parent;
    };
    const patch = (id: string, values: Partial<SubagentTreeEntry>) => {
      if (cancelled) {
        return;
      }
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === id ? { ...entry, ...values } : entry,
        ),
      );
    };

    const loadUsage = (
      id: string,
      agentType: string,
      knownChildren: ReadonlySet<string>,
    ) => {
      const parent = resolveParent();
      if (!parent) {
        return;
      }
      const child = listSubagentSessions(parent).find(
        (session) =>
          session.subagentType === agentType &&
          !knownChildren.has(session.sessionId) &&
          !claimedChildren.has(session.sessionId),
      );
      if (!child) {
        return;
      }
      claimedChildren.add(child.sessionId);
      const session = loadSessionById(child.sessionId);
      if (!session) {
        return;
      }
      const usage = deriveSubagentUsage(session.history);
      const counters: Partial<SubagentTreeEntry> = {
        toolUses: usage.toolUses,
      };
      if (usage.tokens !== null) {
        counters.tokens = usage.tokens;
      }
      patch(id, counters);
    };

    runningByType.clear();
    childIdsAtStart.clear();
    claimedChildren.clear();
    setEntries([]);

    const unsubscribe = subscribeAgentEvents((event) => {
      if (event.type === "subagent.started") {
        if (!matchesSession(event)) {
          return;
        }
        counter += 1;
        const id = `subagent-${counter}`;
        const parent = resolveParent();
        childIdsAtStart.set(
          id,
          new Set(
            parent
              ? listSubagentSessions(parent).map((child) => child.sessionId)
              : [],
          ),
        );
        const siblings = runningByType.get(event.agentName) ?? [];
        siblings.push(id);
        runningByType.set(event.agentName, siblings);
        if (cancelled) {
          return;
        }
        setEntries((previous) => [
          ...previous,
          {
            id,
            agentType: event.agentName,
            description: firstLine(event.prompt),
            status: "running",
            startedAt: event.timestamp,
          },
        ]);
        return;
      }

      if (event.type === "subagent.finished") {
        if (!matchesSession(event)) {
          return;
        }
        const siblings = runningByType.get(event.agentName);
        const id = siblings?.shift();
        if (!id) {
          return;
        }
        const knownChildren = childIdsAtStart.get(id) ?? new Set<string>();
        childIdsAtStart.delete(id);
        patch(id, {
          status: event.success ? "done" : "failed",
          finishedAt: event.timestamp,
          error: event.success
            ? undefined
            : firstLine(event.content) || undefined,
        });
        // The executor saves the child transcript before it emits the finish
        // event, so the counters can be read right after this dispatch.
        queueMicrotask(() => {
          if (cancelled) {
            return;
          }
          loadUsage(id, event.agentName, knownChildren);
        });
        return;
      }

      if (event.type === "session.changed" && matchesSession(event)) {
        if (cancelled) {
          return;
        }
        runningByType.clear();
        childIdsAtStart.clear();
        claimedChildren.clear();
        setEntries([]);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [parentSessionId]);

  return entries;
}
