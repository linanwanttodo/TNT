# Upstream divergences

The tree under `packages/zcode-ui` is vendored ZCode source. Native adaptation means some
files are edited directly; this file is the ledger of those edits, so an upstream refresh
can re-apply or re-evaluate them.

## How to see the current divergence set

The vendoring landed in commit `051490dbb` (with build follow-ups `8850b80df`, `8f5d60745`).
Every direct edit to the vendored tree is visible with:

```bash
git diff 051490dbb -- packages/zcode-ui
```

Add an entry here for every edited file, with the reason and the TNT-side contract it
serves. Prefer editing the smallest component that renders the concept; do not rewrite
shared schema files unless the protocol itself changes.

## Divergence ledger

| File | Change | Reason | TNT contract |
|---|---|---|---|
| (none yet - populated by the native adaptation tasks) | | | |

## Rules

- A divergence must be paired with a test on the TNT side or the vendored package side.
- Protocol additions belong in `@zcode/shared` schemas first, then the UI component, then
  the TNT producer; never let only one of the three change.
- No synthetic values: if the side has no data, the component renders nothing for that
  field rather than a placeholder.
