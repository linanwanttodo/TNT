# TNT Docs

The documentation source lives in this directory; the site that renders it is
`../docs-site` (a Next.js static export, not Mintlify).

## Editing

Pages are MDX. The navigation in `docs.json` is the source of truth for which
pages are reachable — a file that is not listed there is not in the sidebar and
is excluded from the search index. `docs.zh.json` mirrors the same structure
for the Chinese pages under `zh/`.

Snippets shared between pages live in `snippets/`.

Development records live in `worklogs/*.md`. They are plain Markdown, not MDX:
they are not navigation pages, are not in the search index, and are not scanned
by `docs-site/scripts/check-docs-links.ts`. Each entry lists the feature, the
files it touches and its implementation status, so a later session can verify
a behavior without re-deriving it from the code.

Worklogs:

- `2026-10-31-optimization-log.md` — prefix stability, tool recovery and prompt evidence work through 2026-11-13.
- `2026-11-16-feature-ledger.md` — runtime context, automations, worktree, native folder picker, docs link guard, release packaging and CI fixes from 2026-11-14 to 2026-11-16.
- `2026-11-17-context-and-retrieval.md` — context cost, cache attribution, subagent tool bytes, local retrieval and usage metering.

## Building

```bash
cd ../docs-site
npm ci
npm run build
```

The build reads `../docs/*.mdx` by slug and writes the static export to
`docs-site/out`. Deployment to GitHub Pages runs automatically on pushes to
`main` that touch `docs/**` or `docs-site/**` (`.github/workflows/docs-gh-pages.yml`).

## Conventions

- The product is TNT; paths are `~/.tnt` and the binary is `tnt`.
- Chinese pages under `zh/` mirror the English navigation one-to-one; when a
  page is added or renamed, update both `docs.json` and `docs.zh.json`.
