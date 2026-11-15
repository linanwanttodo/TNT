import { publishAgentEvent } from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";

/**
 * The terminal side of a shared conversation, modelled on atomcode's `Live`
 * trait in `tui_share.rs`: the hub holds one runtime handle at a time, and
 * every answer about the session is asked for on demand because `/clear`,
 * `/resume` and the session selector replace it.
 */
export interface LiveSessionInfo {
  sessionId: string;
  title: string;
  workspaceDirectory: string;
}

/** What one turn consumed, projected to the shared view and the terminal. */
export interface TurnUsageProjection {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
  rounds: number;
}

export interface LiveRuntime {
  /** Stable for one TUI process; a second bind replaces the first. */
  runtimeId: string;
  /** One turn: the browser's words land in the same composer path as typing. */
  handleUserMessage(text: string): void;
  /** Asked on every use, never cached: the live session can change. */
  session(): LiveSessionInfo;
  workingDir(): string;
  providerInfo(): { provider: string; model: string };
  /** `/status`, `/cost` and friends only the screen can answer. */
  runCommand?(name: string, args: string[]): Promise<string | null>;
  /** The browser resumed a session from the list; move the screen to it. */
  selectSession?(sessionId: string): void | Promise<void>;
}

/** Answers that only the screen owns, never sent to the model. */
const SCREEN_COMMANDS = new Set([
  "status",
  "cost",
  "help",
  "webui",
  "model",
  "diff",
  "jobs",
  "theme",
  "clear",
  "compact",
]);

export type RemoteOutcome =
  { kind: "sent" } | { kind: "command"; output: string } | { kind: "unbound" };

interface LiveEventBase {
  sessionId: string;
  turnId: string;
  seq: number;
  timestamp: number;
}

/** Omit over each union member, so the payload keys of every event survive. */
type LivePayload<T> = T extends unknown ? Omit<T, keyof LiveEventBase> : never;

/**
 * One runtime per process. The browser speaks the existing ZCode RPC; this
 * hub is the seam where those words are handed to the TUI instead of a second
 * headless engine, and where the TUI's turn is projected back to the browser.
 */
class LiveHub {
  private live: LiveRuntime | null = null;
  private eventSeq = 0;
  private turnCounter = 0;
  private turnId = "live-0";

  bind(runtime: LiveRuntime): void {
    this.live = runtime;
    this.publish({ type: "session.changed" });
  }

  unbind(runtimeId: string): void {
    if (this.live?.runtimeId === runtimeId) {
      this.live = null;
    }
  }

  current(): LiveRuntime | null {
    return this.live;
  }

  isBound(): boolean {
    return this.live !== null;
  }

  /** Connection point 1: the browser's text becomes a TUI turn. */
  async acceptRemoteText(text: string): Promise<RemoteOutcome> {
    const live = this.live;
    if (!live) {
      return { kind: "unbound" };
    }
    const trimmed = text.trim();
    if (trimmed.startsWith("/") && live.runCommand) {
      const [name, ...args] = trimmed.slice(1).split(/\s+/);
      if (name && SCREEN_COMMANDS.has(name.toLowerCase())) {
        // Connection point 4: the screen runs the command. Its answer is a
        // separate projection, never appended to the shared session file.
        const output = (await live.runCommand(name, args)) ?? "";
        this.publishCommandOutput(trimmed, output);
        return { kind: "command", output };
      }
    }
    live.handleUserMessage(text);
    return { kind: "sent" };
  }

  /** Connection point 3: the terminal's accepted input becomes a fact. */
  publishTurnStarted(userInput: string): void {
    const live = this.live;
    if (!live) return;
    this.turnId = `live-${++this.turnCounter}`;
    this.eventSeq = 0;
    const { model } = live.providerInfo();
    this.publish({
      type: "turn.started",
      model,
      historyLength: 0,
      userInput,
    });
  }

  publishContent(delta: string): void {
    if (delta) this.publish({ type: "content.delta", delta });
  }

  publishReasoning(delta: string): void {
    if (delta) this.publish({ type: "reasoning.delta", delta });
  }

  publishToolStarted(
    toolName: string,
    args?: unknown,
    toolCallId?: string,
  ): void {
    this.publish({ type: "tool.started", toolName, args, toolCallId });
  }

  publishToolFinished(
    toolName: string,
    status: "done" | "errored" | "canceled",
    result?: string,
    toolCallId?: string,
  ): void {
    this.publish({
      type: "tool.finished",
      toolName,
      status,
      result,
      toolCallId,
    });
  }

  publishTurnCompleted(
    options: {
      interrupted?: boolean;
      content?: string;
      usage?: TurnUsageProjection;
    } = {},
  ): void {
    if (options.interrupted) {
      this.publish({
        type: "turn.interrupted",
        reason: "user_abort",
        turnTotals: options.usage,
      });
      return;
    }
    this.publish({
      type: "turn.completed",
      content: options.content,
      turnTotals: options.usage,
    });
  }

  publishTurnFailed(message: string): void {
    this.publish({ type: "turn.failed", message });
  }

  /**
   * The command line's answer. atomcode has a dedicated
   * `publish_command_output` channel; TNT projects it through a short turn so
   * the existing frontend sees it without a protocol change. It never touches
   * `chatHistory`, so it is not part of the shared conversation.
   */
  publishCommandOutput(command: string, output: string): void {
    const live = this.live;
    if (!live) return;
    this.turnId = `live-cmd-${++this.turnCounter}`;
    this.eventSeq = 0;
    const { model } = live.providerInfo();
    this.publish({
      type: "turn.started",
      model,
      historyLength: 0,
      userInput: command,
    });
    this.publish({ type: "content.delta", delta: output });
    this.publish({ type: "turn.completed", content: output });
  }

  /** `/clear`, `/resume` and selector switches invalidate the browser view. */
  notifySessionChanged(): void {
    const live = this.live;
    if (!live) return;
    this.publish({ type: "session.changed" });
  }

  private publish(partial: LivePayload<AgentEvent>): void {
    const live = this.live;
    if (!live) return;
    const base: LiveEventBase = {
      sessionId: live.session().sessionId,
      turnId: this.turnId,
      seq: ++this.eventSeq,
      timestamp: Date.now(),
    };
    publishAgentEvent({ ...base, ...partial } as AgentEvent);
  }
}

export const liveHub = new LiveHub();

/**
 * The browser-to-screen seam for the host engine. An unbound process answers
 * false and the headless engine keeps the text; a bound TUI hands its turn
 * over to the live runtime.
 */
export async function acceptRemoteTextViaBridge(
  text: string,
): Promise<boolean> {
  if (!liveHub.isBound()) return false;
  const outcome = await liveHub.acceptRemoteText(text);
  return outcome.kind !== "unbound";
}

/** Test-only: drop the singleton's state between cases. */
export function resetLiveHubForTesting(): void {
  liveHub.unbind(liveHub.current()?.runtimeId ?? "");
  (liveHub as unknown as { eventSeq: number }).eventSeq = 0;
  (liveHub as unknown as { turnCounter: number }).turnCounter = 0;
}
