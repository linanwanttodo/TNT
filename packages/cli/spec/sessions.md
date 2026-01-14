# Session files

Status: v2 store implemented 2026-10-23. The legacy flat JSON session is still
read and is migrated on the first write.

## Layout

```
~/.tnt/sessions/<filesystem-name>/
  session.jsonl      # source of truth: header + append-only records
  meta.json          # derived cache for listing; rebuildable from the log
  lock               # writer lease (pid + writer id)
  tool-results/      # oversized tool results
  cache-breaks/      # prefix diff reports
  block-overflow/    # lines the terminal could not show
```

The directory name is the session id when it is filesystem-safe. An id with
`:` (delegated runs) or another unsafe character gets a short content hash so
two ids cannot address the same directory. The real id lives in the header and
in `meta.json`.

`~/.tnt/sessions/sessions.json` is no longer written. It is read only to find
legacy flat files.

## Records

The first line is a header:

```json
{
  "type": "session",
  "version": 2,
  "sessionId": "…",
  "createdAt": "…",
  "cwd": "…",
  "title": "…",
  "source": "cli"
}
```

Every later line is one record:

| Type            | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `message`       | one `ChatHistoryItem`, with a stable `messageId` and `parentId`         |
| `message-patch` | replacement for a message with the same `messageId` (tool state/result) |
| `compaction`    | the visible history after a compaction; earlier bodies stay in the log  |
| `session-info`  | title, mode, model title, usage, goal, output style, prompt profile     |
| `rewind`        | truncate the visible history to a message id, or clear it               |
| `snapshot`      | last-resort replacement for a diverged/reordered history                |

The log is append-only. A tool result updates its assistant message through a
`message-patch`; a compaction appends a `compaction` record instead of deleting
the messages that were folded away. Loading applies the records in order and
returns the same `Session.history` the live process holds.

## Write path

`ChatHistoryService` is the only writer. It already updates history immutably,
so `updateSessionHistory` can diff the next array against the last projection:
new tail messages become `message` records, changed messages become
`message-patch` records, and a shorter history becomes `rewind` (or a
`snapshot` when the prefix does not match). A compaction is recognised by the
`conversationSummary`/`compactionCheckpoint` item and becomes a `compaction`
record.

`meta.json` is written atomically after the log append. A crash between the two
leaves a valid log with an older cache; listing notices the transcript's newer
mtime and rebuilds the cache.

## Listing and loading

`session/list` and `tnt ls` read `meta.json` instead of opening every
transcript. The cache carries the title, cwd, assistant count, entry count,
first-user-message preview, source, parent link and timestamps. A missing or
stale cache is rebuilt from the header and records.

A corrupt transcript fails closed: the loader raises a `SessionStoreError`
instead of fabricating an empty session. The CLI reports "could not open" and
does not overwrite the file. Malformed trailing lines from a partial append are
skipped.

## Leases

A live writer holds `<session>/lock` (`wx` create, pid + writer id). A second
process gets a clear "already open" error instead of last-writer-wins. A lock
whose pid is gone is stale and is replaced. `session/close` and process exit
release the lease; `session/delete` removes the directory, which removes the
lock too.

## Delete

`session/delete` (and `clearSession`) stop any worker first, then remove the
whole session directory: transcript, metadata, lock, tool results, cache-break
reports and overflow files. Legacy flat files and their old sidecar directories
are removed as well. The legacy index row is filtered best-effort; the source of
truth is the directory.

## Migration

A missing v2 directory falls back to `<id>.json`. The first save writes the v2
log and renames the legacy file to `<id>.json.legacy`. Legacy `sessions.json`
rows remain readable until their flat file is gone.

## Hook contract

`transcript_path` in hook input points at the v2 `session.jsonl` when it exists,
otherwise at the legacy `.json` file. The path is stable for the session.

## Known limits

- One writer per session; concurrent turns are serialized by the lease, not
  merged.
- A `snapshot` record duplicates the visible history when a rewind/reorder
  cannot be expressed as an append. It is rare and keeps correctness over
  compactness.
- `sessions.json` is not repaired; old rows disappear from listings when their
  file is gone.
