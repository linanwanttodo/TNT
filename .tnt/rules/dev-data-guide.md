---
alwaysApply: false
---

# Development data (dev data) — a core-only subsystem

## What it actually is

Dev data is the `core/` event-logging layer, not a CLI feature. **No file under
`packages/cli` imports `DataLogger` or writes to `dev_data`** — a TNT CLI run
produces none of it, on any surface.

- `core/data/log.ts` — the `DataLogger` singleton. One argument, not two:
  `await DataLogger.getInstance().logDevData({ name: "chatInteraction", data: {...} })`.
  The event type is `DevDataLogEvent` in `packages/config-yaml/src/schemas/data/index.ts`,
  keyed by event name.
- `core/data/devdataSqlite.ts` — the SQLite destination implementation.
- `core/util/paths.ts` — `getDevDataPath()` joins the global directory with
  `dev_data`; `getDevDataFilePath(event, version)` builds
  `{eventName}.jsonl` under the schema version. The global directory is `~/.tnt`
  (`TNT_GLOBAL_DIR` / `TNT_GLOBAL_DIR` override), so the default path is
  `~/.tnt/dev_data/0.2.0/{eventName}.jsonl`, with `devdata.sqlite` beside it.
  `LOCAL_DEV_DATA_VERSION` in `core/data/log.ts` is `0.2.0`.
- `packages/config-yaml/src/schemas/data/` — one directory per event type plus
  `base.ts`. Every event carries `eventName`, `schema`, `timestamp`, `userId`,
  `userAgent` and `selectedProfileId`; `logDevData` fills them, callers pass only
  the event-specific fields.

## Which events still have a producer

The schemas outlive the surfaces that emitted them. `autocomplete`, `quickEdit`,
`editOutcome`, `nextEditOutcome` and `chatFeedback` belong to editor features that
were removed from this repository; the completion engine that carried their
logging services was deleted with the session host in 2026-10, so those schemas
now describe events nothing can emit.
The one emission that exists in `core/` is `tokensGenerated` in
`core/llm/index.ts`, and the CLI does not import that module — it only uses
`core/llm/utils/calculateRequestCost.ts`, `core/llm/logger.ts` and
`core/llm/getAdjustedTokenCount.ts`.

## The `data` block in config.yaml

`packages/config-yaml` validates a `data` array, but the CLI config loader never
reads it. Writing a `data:` block today has no effect on a CLI run. Do not
document it as working, and do not add a `~/.tnt/dev_data` step to a troubleshooting
guide.

## If you wire it up later

- Keep the privacy levels honest: `"all"` includes code prefixes/suffixes,
  `"noCode"` must exclude them. Never widen a level silently.
- Log at the surface boundary, not inside a provider adapter, so all four
  surfaces stay consistent (one engine, four surfaces).
- Credentials and file contents the user pasted must never enter an event.
- A new event needs a schema directory, an entry in `schemas/data/index.ts`, and
  a version decision if the shape breaks existing consumers.
