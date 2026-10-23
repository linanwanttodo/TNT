import type { ChatHistoryItem } from "core/index.js";

/**
 * Stable identity for one message in a session.
 *
 * The CLI still exchanges `ChatHistoryItem[]` with core, so the id lives here
 * rather than on the core type. A WeakMap keeps it attached to the item object
 * without changing the object a provider sees.
 */
export type MessageId = string;

export interface TranscriptEntry {
  id: MessageId;
  item: ChatHistoryItem;
}

export type ReplaceReason = "load" | "rewind" | "compaction" | "sync";

export interface SnapshotOptions {
  /** Include a staged assistant message that has not committed with its tools. */
  includeStaged?: boolean;
}

/**
 * The transcript: ordered messages with stable ids, an append path, and a
 * staging batch for the assistant message plus the tool results it produced.
 *
 * Appends are the normal write. `replace` exists for the three boundaries that
 * legitimately rewrite the list - loading a session, rewinding for an edit, and
 * a compaction that arrives as a new view - and says so in its reason.
 */
export class Transcript {
  private entries: TranscriptEntry[] = [];
  private staged: TranscriptEntry[] = [];
  private ids = new WeakMap<ChatHistoryItem, MessageId>();
  private usedIds = new Set<MessageId>();
  private counter = 0;
  private compactionMarkId: MessageId | null = null;

  private idFor(item: ChatHistoryItem): MessageId {
    const existing = this.ids.get(item);
    if (existing) {
      return existing;
    }

    const carried = (item as ChatHistoryItem & { messageId?: string })
      .messageId;
    let id =
      carried && !this.usedIds.has(carried) ? carried : `msg-${++this.counter}`;
    const carriedNumber = carried
      ? /^msg-(\d+)$/.exec(carried)?.[1]
      : undefined;
    if (carriedNumber) {
      this.counter = Math.max(this.counter, Number(carriedNumber));
    }
    while (this.usedIds.has(id)) {
      id = `msg-${++this.counter}`;
    }

    (item as ChatHistoryItem & { messageId?: string }).messageId = id;
    this.ids.set(item, id);
    this.usedIds.add(id);
    return id;
  }

  append(item: ChatHistoryItem): TranscriptEntry {
    const entry = { id: this.idFor(item), item };
    this.entries.push(entry);
    return entry;
  }

  appendBatch(items: readonly ChatHistoryItem[]): TranscriptEntry[] {
    return items.map((item) => this.append(item));
  }

  /** Holds a batch until `commitStaged`, so a failed turn leaves no half. */
  stage(items: readonly ChatHistoryItem[]): TranscriptEntry[] {
    this.staged = items.map((item) => ({ id: this.idFor(item), item }));
    return [...this.staged];
  }

  commitStaged(): TranscriptEntry[] {
    const committed = [...this.staged];
    this.entries.push(...committed);
    this.staged = [];
    return committed;
  }

  discardStaged(): void {
    this.staged = [];
  }

  replace(items: readonly ChatHistoryItem[], _reason: ReplaceReason): void {
    this.entries = items.map((item) => ({ id: this.idFor(item), item }));
    this.staged = [];
    if (
      this.compactionMarkId &&
      !this.entries.some((entry) => entry.id === this.compactionMarkId)
    ) {
      this.compactionMarkId = null;
    }
  }

  /** Marks the first message a compaction view retains. Bodies stay intact. */
  markCompaction(index: number): void {
    this.compactionMarkId = this.entries[index]?.id ?? null;
  }

  getCompactionMarkId(): MessageId | null {
    return this.compactionMarkId;
  }

  getCompactionIndex(): number | null {
    if (!this.compactionMarkId) {
      return null;
    }
    const index = this.entries.findIndex(
      (entry) => entry.id === this.compactionMarkId,
    );
    return index === -1 ? null : index;
  }

  getMessageId(item: ChatHistoryItem): MessageId | undefined {
    return this.ids.get(item);
  }

  entriesSnapshot(): readonly TranscriptEntry[] {
    return [...this.entries];
  }

  stagedSnapshot(): readonly TranscriptEntry[] {
    return [...this.staged];
  }

  snapshot(options: SnapshotOptions = {}): ChatHistoryItem[] {
    const items = this.entries.map((entry) => entry.item);
    if (options.includeStaged !== false && this.staged.length > 0) {
      items.push(...this.staged.map((entry) => entry.item));
    }
    return items;
  }

  get length(): number {
    return this.entries.length;
  }
}
