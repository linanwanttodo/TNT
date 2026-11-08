# Vendored ZCode build order

The packages under this directory are installed independently with npm `file:`
links rather than a workspace. Web's Vite build compiles ui and its dependencies
from source, so the build chain installs most packages and only builds the few
whose declaration output the next package reads. Emitting declaration trees for
every package is a separate typecheck gate; see below.

## Layout shims (committed)

- `packages/package.json` supplies the version that web's vite config reads as
  its repository root.
- `npm install` in `ui`, `shared`, and `services` runs
  `scripts/apply-vendor-patches.mjs` as a postinstall hook. The script applies
  the files in `patches/` to the installed dependency tree and is idempotent.

## Build chain

Run from `packages/zcode-ui`. This is the order `packages/cli`'s
`build:zcode-ui` script runs, and the two must stay in sync.

```bash
(cd model-option-map && npm install --no-audit --no-fund && npm run build)
(cd rpc && npm install --no-audit --no-fund && npm run build)
(cd shared && npm install --no-audit --no-fund && npx tsc -p tsconfig.json)
(cd provider && npm install --no-audit --no-fund && npm run build)
(cd provider-node && npm install --no-audit --no-fund && npm run build)
(cd zcode-cua && npm install --no-audit --no-fund)
(cd services && npm install --no-audit --no-fund)
(cd ui && npm install --no-audit --no-fund)
(cd client && npm install --no-audit --no-fund)
node scripts/ensure-d3-path-shim.mjs
(cd web && npm install --no-audit --no-fund && npm run build)
```

`zcode-cua`, `services`, `ui`, and `client` are install-only: Vite consumes their
source through the package exports, so no emit belongs in every build.

`scripts/ensure-d3-path-shim.mjs` writes
`packages/node_modules/d3-path/src/index.js`, the 3.x hoist shim that web's
`d3-path` alias resolves. It fails loudly when ui has not been installed yet.

## Typecheck gate

The build chain does not emit declaration trees for ui or services. The vendor
typechecks need them, so run this gate manually - or from a future dedicated
script - after the build chain:

```bash
(cd model-option-map && npm run build)
(cd rpc && npm run build)
(cd services && npx tsc -p tsconfig.json)
(cd ui && npx tsc -p tsconfig.json)
(cd services && npx tsc --noEmit -p tsconfig.vendor.json)
(cd ui && npx tsc --noEmit -p tsconfig.vendor.json)
(cd web && npx tsc --noEmit -p tsconfig.vendor.json)
```
