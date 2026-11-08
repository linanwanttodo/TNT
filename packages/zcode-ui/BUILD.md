# Vendored ZCode build order

The packages under this directory are installed and built independently with
npm `file:` links rather than a workspace. Run the steps from
`packages/zcode-ui` in the order below: each package consumes the declaration
output of the packages before it.

## Layout shims (committed)

- `packages/package.json` supplies the version that web's vite config reads as
  its repository root.
- `packages/scripts/third-party-notices.mjs` is the notices plugin web's vite
  config imports. Its repository root points at `packages/zcode-ui`, where
  `THIRD-PARTY-NOTICES.md` lives.
- `npm install` in `ui`, `shared`, and `services` runs
  `scripts/apply-vendor-patches.mjs` as a postinstall hook. The script applies
  the files in `patches/` to the installed dependency tree and is idempotent.

## Install and build

```bash
cd packages/zcode-ui
(cd model-option-map && npm install --no-audit --no-fund && npm run build)
(cd rpc && npm install --no-audit --no-fund && npm run build)
(cd shared && npm install --no-audit --no-fund && npx tsc -p tsconfig.json)
(cd provider && npm install --no-audit --no-fund && npm run build)
(cd provider-node && npm install --no-audit --no-fund && npm run build)
(cd zcode-cua && npm install --no-audit --no-fund && npm run build)
(cd services && npm install --no-audit --no-fund && npx tsc -p tsconfig.json)
(cd ui && npm install --no-audit --no-fund && npx tsc -p tsconfig.json)
(cd client && npm install --no-audit --no-fund && npx tsc -p tsconfig.json)
```

Web's vite config aliases `d3-path` to the upstream hoisted location. After
`ui` is installed, provide that path before building web:

```bash
node -e "
const fs = require('fs');
fs.mkdirSync('../node_modules/d3-path/src', { recursive: true });
fs.writeFileSync(
  '../node_modules/d3-path/src/index.js',
  'export * from \"../../../zcode-ui/ui/node_modules/d3-path/dist/d3-path.mjs\";\n',
);
"
(cd web && npm install --no-audit --no-fund && npm run build)
```

## Vendor typechecks

These are the checks that gate the vendored closure. They require the `dist`
outputs produced above.

```bash
(cd services && npx tsc --noEmit -p tsconfig.vendor.json)
(cd ui && npx tsc --noEmit -p tsconfig.vendor.json)
(cd web && npx tsc --noEmit -p tsconfig.vendor.json)
```
