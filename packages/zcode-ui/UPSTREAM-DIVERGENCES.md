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
| `web/src/main.tsx` | Replaced the upstream entry (cloud auth, login/callback, conversation sharing, remote control relay, telemetry boot) with a call to `bootstrapTntWebUi` and `createWebPlatform`; the connection URL comes from the host, not `window.location`. | TNT has no cloud, accounts, billing, sharing or relay; the shell must run against a local engine. | `docs/CLIENTS.md`, `webuiBootstrap` options (`wsUrl`, `initialWorkspaceAbsPath`, `IPlatformService`). |
| `web/src/webuiBootstrap.tsx` | New host entry: mounts the shell with an explicit socket URL, workspace and platform service, and exposes the bootstrap for VS Code/JetBrains/Electron hosts. | One UI, many hosts: the browser path and native hosts share the same mount code. | `TNT_WEBUI_*` handshake in `docs/CLIENTS.md`; `webuiDist.ts`. |
| `web/vite.config.ts` | Added React/React-DOM dedupe; removed cloud/notice/OAuth env resolution and the upstream repo-root version read; keeps the vendored source aliases and frontend version. | Per-package installs (file: links) give `ui` and `web` separate React copies, which breaks hooks; the upstream config imports modules that only exist in the ZCode cloud build. | `packages/cli/build.mjs` copies `web/dist` into `dist/webui`. |
| `ui/src/Root.tsx` | The provider-availability login gate is disabled unless the root is the web remote-control surface. | TNT serves models from its own config; there is no ZCode account to connect, so the startup gate must not open the cloud login screen. | `modelSelectionService` in `src/webuiZcode/services/modelSelection.ts`. |
| `*/package.json`, `*/package-lock.json` | Vendored packages are linked with `file:` and installed per package instead of the upstream workspace. | The TNT repo is not the ZCode monorepo. | `validate-aliases.mjs`; `npm run build:webui`. |
| `patches/`, `scripts/apply-vendor-patches.mjs` | Upstream patch files moved into `patches/` and applied by the vendored build script. | Keeps upstream patches reproducible without the upstream repo root. | `web/ui` postinstall. |

The remaining UI source is the upstream tree verbatim; changes to it must be recorded in
this table and paired with a test.

## Rules

- A divergence must be paired with a test on the TNT side or the vendored package side.
- Protocol additions belong in `@zcode/shared` schemas first, then the UI component, then
  the TNT producer; never let only one of the three change.
- No synthetic values: if the side has no data, the component renders nothing for that
  field rather than a placeholder.
