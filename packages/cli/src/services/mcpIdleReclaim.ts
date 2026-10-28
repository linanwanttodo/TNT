/**
 * How long a connected MCP server may sit without a tool call before its process
 * is released, and the interval that checks for it. `0` (or a negative value) in
 * the environment turns reclaiming off.
 */
const DEFAULT_MCP_IDLE_TIMEOUT_MS = 300_000;
const IDLE_SWEEP_INTERVAL_MS = 30_000;
const MIN_SWEEP_INTERVAL_MS = 25;

import { MCPServerStatus } from "./types.js";

/**
 * The parts of a server connection the sweep needs. Kept structural so this
 * module does not import the client, and a connection stays the service's own
 * business.
 */
export interface ReclaimableConnection {
  status: MCPServerStatus;
  /** Calls in flight, which the sweep must not cut off. */
  inFlight: number;
  /** When this server was connected or last called - the start of its window. */
  lastUsedAt: number;
  /** Set while this connection is being released, so the next tick skips it. */
  reclaiming?: boolean;
  /** Present only while the server's process and socket are live. */
  client?: unknown;
}

/** Reclaiming window in ms, from `TNT_MCP_IDLE_TIMEOUT_MS`. */
export function idleTimeoutMs(): number {
  const fromEnv = process.env.TNT_MCP_IDLE_TIMEOUT_MS;
  if (fromEnv === undefined || fromEnv.trim() === "") {
    return DEFAULT_MCP_IDLE_TIMEOUT_MS;
  }
  const parsed = Number(fromEnv);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MCP_IDLE_TIMEOUT_MS;
}

/**
 * A short window must be checked more often than a long one, and no sweep may
 * sleep past the window it is enforcing.
 */
export function sweepIntervalMs(idleMs: number): number {
  return Math.min(
    IDLE_SWEEP_INTERVAL_MS,
    Math.max(MIN_SWEEP_INTERVAL_MS, idleMs / 2),
  );
}

/**
 * Idle MCP servers cost a process each, and a session may never call one of
 * them. This releases those while a caller keeps their published tool list: the
 * owner passes the connections to look at and how to release one, and this
 * module owns the schedule.
 */
export class IdleReclaimer<T extends ReclaimableConnection> {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly connections: () => T[],
    private readonly release: (connection: T) => Promise<void>,
  ) {}

  /** Safe to call for every new connection; only the first one starts a timer. */
  public start(): void {
    const idleMs = idleTimeoutMs();
    if (this.timer || idleMs <= 0) {
      return;
    }
    // `unref()` matters: an interval holding the event loop open would keep a
    // headless run alive after its turn finished.
    const timer = setInterval(() => {
      void this.sweep();
    }, sweepIntervalMs(idleMs));
    timer.unref?.();
    this.timer = timer;
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One pass over the connections. A release that hangs is left hanging: the
   * connection is marked before the first await, so a later tick cannot pick it
   * up and kill the same process twice.
   */
  public async sweep(): Promise<void> {
    const idleMs = idleTimeoutMs();
    if (idleMs <= 0) {
      this.stop();
      return;
    }
    const now = Date.now();
    const reclaimable = this.connections().filter(
      (connection) =>
        connection.status === "connected" &&
        !connection.reclaiming &&
        connection.inFlight === 0 &&
        now - connection.lastUsedAt >= idleMs,
    );
    if (reclaimable.length === 0) {
      if (this.connections().every((c) => !c.client)) {
        this.stop();
      }
      return;
    }
    await Promise.all(
      reclaimable.map((connection) => {
        connection.reclaiming = true;
        return this.release(connection).finally(() => {
          connection.reclaiming = false;
        });
      }),
    );
  }
}
