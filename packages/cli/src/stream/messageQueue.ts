import { EventEmitter } from "events";

import type { InputHistory } from "../utils/inputHistory.js";
import { logger } from "../utils/logger.js";

export interface QueuedMessage {
  /** Stable identity for display updates; the text is not unique. */
  id: string;
  message: string;
  imageMap?: Map<string, Buffer>;
  timestamp: number;
  history?: InputHistory;
}

export interface MessageProcessor {
  (message: string, imageMap?: Map<string, Buffer>): Promise<void>;
}

/**
 * Messages waiting for the current turn to finish.
 *
 * The queue is the authority for ordering and identity. Views subscribe to the
 * change events and redraw from `getAllMessages()` instead of keeping their
 * own copy, so removing or editing one entry cannot leave a stale row behind.
 */
class MessageQueue extends EventEmitter {
  private queue: QueuedMessage[] = [];
  private nextId = 1;

  constructor() {
    super();
  }

  async enqueueMessage(
    message: string,
    imageMap?: Map<string, Buffer>,
    history?: InputHistory,
  ): Promise<boolean> {
    const queuedMessage: QueuedMessage = {
      id: `queued-${this.nextId++}`,
      message,
      imageMap,
      timestamp: Date.now(),
      history,
    };

    this.queue.push(queuedMessage);
    logger.debug("MessageQueue: Message queued", {
      queueLength: this.queue.length,
    });

    this.emit("messageQueued", queuedMessage);

    return true;
  }

  /**
   * Dequeues and returns the next message to be processed (FIFO - oldest
   * first). Emits the dequeue so a view removes that row rather than guessing
   * that the whole queue was consumed.
   */
  public getNextMessage(): QueuedMessage | undefined {
    const next = this.queue.shift();
    if (next) {
      this.emit("messageDequeued", next);
    }
    return next;
  }

  /** Removes one entry by id, for the view's remove action. */
  public removeMessage(id: string): QueuedMessage | undefined {
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return undefined;
    }

    const [removed] = this.queue.splice(index, 1);
    this.emit("messageRemoved", removed);
    return removed;
  }

  /** Replaces the text of one entry, for the view's edit action. */
  public updateMessage(id: string, message: string): boolean {
    const entry = this.queue.find((candidate) => candidate.id === id);
    if (!entry || entry.message === message) {
      return false;
    }

    entry.message = message;
    this.emit("messageUpdated", entry);
    return true;
  }

  /** Drops every waiting entry, for a reset or an interrupted compaction. */
  public clearMessages(): void {
    if (this.queue.length === 0) {
      return;
    }
    this.queue = [];
    this.emit("messageCleared");
  }

  /** A snapshot for a view that just mounted or needs to resync. */
  public getAllMessages(): readonly QueuedMessage[] {
    return [...this.queue];
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export const messageQueue = new MessageQueue();
