# TNT Docs

The documentation source lives in this directory; the site that renders it is
`../docs-site` (a Next.js static export, not Mintlify).

## Editing

Pages are MDX. The navigation in `docs.json` is the source of truth for which
pages are reachable — a file that is not listed there is not in the sidebar and
is excluded from the search index. `docs.zh.json` mirrors the same structure
for the Chinese pages under `zh/`.

Snippets shared between pages live in `snippets/`.

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
