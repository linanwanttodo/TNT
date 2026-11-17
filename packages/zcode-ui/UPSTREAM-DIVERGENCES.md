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

Baseline refresh (2026-11-17): the workflow-related vendored files were refreshed to
upstream v3.18.2 (`fec97590`) — the 24 files under `ui/src` in `components/workflow-timeline/`
(WorkflowAgentFace, workflow-face-motion, WorkflowAgentPill, WorkflowRoll, WorkflowRosterParts,
WorkflowSettingsChangeRow, WorkflowTimelineFills), `app-shell/` (WorkflowRunHoleParts,
WorkflowRunProvenance, WorkflowRunSidePaneSections), `ToolCallBlocks/renderers/` (create-workflow,
eval-workflow-snippet, get-workflow-run, list-workflow-runs, workflow-draft-row, workflow-fill-row,
workflow-snippet-presentation), `lib/workflowObservationFormat.ts`, `v4/WorkflowToolSummary.tsx`,
`settings/DynamicWorkflowModeSetting.tsx`, `hooks/useDynamicWorkflowAvailability.ts` and
`settings/saved-workflows/` (SavedWorkflowCard, SavedWorkflowRunHistoryPanel, SavedWorkflowsSection),
plus `shared/src/zcode-protocol-v4/workflow-observation-display.ts` and
`services/src/session/automationRepo.ts` (upstream `pauseAutomationsForArchivedTask`); the rest of
the vendored tree stays at the previous snapshot. `WorkflowRunDigest.tsx` was deliberately not
refreshed (grid fix below), and `settings/DynamicWorkflowModeSetting.tsx` +
`settings/saved-workflows/SavedWorkflowsSection.tsx` were reverted to the baseline afterwards:
their v3.18.2 versions depend on the upstream settings-search subsystem (`searchId` prop,
`SettingsSectionId` agentBehavior member) that TNT does not vendor, and neither component renders
in TNT. `core.ts` took the upstream `v4ColdResumeWorkspaceSchema` addition, so
`shared/src/zcode-protocol-v4/{workflow-artifacts,workflow-workspace}.ts` are at v3.18.2 too.

Add an entry here for every edited file, with the reason and the TNT-side contract it
serves. Prefer editing the smallest component that renders the concept; do not rewrite
shared schema files unless the protocol itself changes.

## Divergence ledger

| File | Change | Reason | TNT contract |
|---|---|---|---|
| `web/src/main.tsx` | Replaced the upstream entry (cloud auth, login/callback, conversation sharing, remote control relay, telemetry boot) with a call to `bootstrapTntWebUi` and `createWebPlatform`; the connection URL comes from the host, not `window.location`. | TNT has no cloud, accounts, billing, sharing or relay; the shell must run against a local engine. | `docs/CLIENTS.md`, `webuiBootstrap` options (`wsUrl`, `initialWorkspaceAbsPath`, `IPlatformService`). |
| `web/src/platform/index.ts` | `selectDirectories`/`selectDirectory` call `POST /api/select-directory`; the host spawns its native desktop folder chooser (zenity/kdialog/yad) instead of the in-page directory browser. | "选择文件夹" must open the OS file manager, as it does on the desktop app; a browser cannot, but the TNT WebUI server runs on that same desktop. | `services/webuiNativeDirectory.ts` (token-gated route), `ProjectEditor.browse`. |
| `web/src/webuiBootstrap.tsx` | New host entry: mounts the shell with an explicit socket URL, workspace and platform service, and exposes the bootstrap for VS Code/JetBrains/Electron hosts. | One UI, many hosts: the browser path and native hosts share the same mount code. | `TNT_WEBUI_*` handshake in `docs/CLIENTS.md`; `webuiDist.ts`. |
| `web/vite.config.ts` | Added React/React-DOM dedupe; removed cloud/notice/OAuth env resolution and the upstream repo-root version read; keeps the vendored source aliases and frontend version. | Per-package installs (file: links) give `ui` and `web` separate React copies, which breaks hooks; the upstream config imports modules that only exist in the ZCode cloud build. | `packages/cli/build.mjs` copies `web/dist` into `dist/webui`. |
| `ui/src/Root.tsx` | The provider-availability login gate is disabled unless the root is the web remote-control surface. | TNT serves models from its own config; there is no ZCode account to connect, so the startup gate must not open the cloud login screen. | `modelSelectionService` in `src/webuiZcode/services/modelSelection.ts`. |
| `*/package.json`, `*/package-lock.json` | Vendored packages are linked with `file:` and installed per package instead of the upstream workspace. | The TNT repo is not the ZCode monorepo. | `validate-aliases.mjs`; `npm run build:webui`. |
| `patches/`, `scripts/apply-vendor-patches.mjs` | Upstream patch files moved into `patches/` and applied by the vendored build script. | Keeps upstream patches reproducible without the upstream repo root. | `web/ui` postinstall. |
| `ui/src/host-capabilities.ts` | New host capability snapshot (`codingPlan`, `localProvidersOnly`, `localFileSettings`); `setHostCapabilities` is called by `webuiBootstrap` before the first render. | The shell was built for the ZCode desktop app and rendered account login, coding-plan purchases and desktop-only file settings on a host that has none of them. | `web/src/webuiBootstrap.tsx`; TNT host has no ZCode account and edits files on the served machine. |
| `ui/src/Root.tsx`, `ui/src/root/WorkspaceSettingsLayer.tsx` | The settings layer treats the host as local when `localFileSettings` is set, so personalization and the memory viewer render. | Those editors read and write files on the machine serving the page, which is the TNT host itself. | `ISettingService.getUserInstructions`, `IMemoryService`. |
| `ui/src/SettingsPage.tsx` (via `settings/settingsPageConfig.ts`) | Remote-devices and cloud data-sync sections stay hidden when `localProvidersOnly` is set, even though local file settings are enabled. | Those sections belong to the ZCode account/relay, which TNT does not ship. | `host-capabilities.ts`. |
| `ui/src/v4/SessionPane.tsx`, `ui/src/ChatErrorBanner.tsx` | The no-model banner no longer offers the coding-plan upgrade button, and uses a local "add a provider and API key" message, when `codingPlan` is false. | There is no plan to buy; the only real recovery is the model settings page. | `IProviderSettingsService`; `chat.error.noAvailableModel.local` locale key. |
| `ui/src/settings/ModelProviderSection.tsx`, `ui/src/settings/model-provider-section/useModelProviderNavigation.ts`, `Navigation.tsx` | Cloud preset providers and coding-plan nav groups are omitted when `localProvidersOnly` is set; empty provider groups are not rendered. | The presets open ZCode login/purchase flows for providers TNT configures with an API key instead. | `IProviderSettingsService` view built from TNT `config.yaml`. |
| `ui/src/settings/model-provider-section/ProviderModelMetadata.ts` | An empty reasoning-level list is valid for a new model; only blank or duplicate entries are rejected. | Local providers may expose no reasoning levels, and ZCode's cloud registry was the only source that populated the list. | TNT model entries have no per-model reasoning option. |
| `ui/src/settings/SubagentsSection.tsx`, `shared/src/subagents-types.ts`, `services/src/subagents/subagentsService.ts` | A built-in agent's model override is keyed by its own name (string), not the two ZCode built-in names. | TNT ships nine built-in agents (explore, debug, verification, ...) and the picker must offer an override for each. | `subagent/builtInAgents.ts`, `subagent/agentState.ts`. |
| `ui/src/settings/AutomationsSection.tsx`, `ui/src/settings/saved-workflows/WorkflowRunsSection.tsx`, `i18n/locales/{zh-CN,en-US}.ts` | The automations page always shows both page tabs; the Workflow tab lists TNT team runs instead of ZCode's saved-workflow files, with a five-status filter, a highlighted open-session entry on resumable failed/stopped runs, and localized timestamps. Dead CodingPlan-era code and the unavailable availability hook are gone. | The dynamic-workflow grey flag never turns on in TNT; cron tasks and team runs are the same orchestration feature (both dispatch subagents). | `IZCodeAgentService.listWorkflowRuns`, `appServer/workflowRunSummaries.ts`, `v4.workflowRuns`, `formatWorkflowTimestamp(epochMs, locale?)`. |
| `ui/src/settings/saved-workflows/workflowRunsStatusFilter.ts` (new), with `workflowRunsStatusFilter.test.ts` | Pure helpers: the five run statuses fold into four filter groups, and the open-session entry is gated on `resumable` so no row advertises an action it cannot take. | The team-run list needs the automations tab's filter shape without vendoring the saved-workflow hub. | `ZCodeWorkflowRunSummary.status` / `.resumable`. |
| `ui/src/settings/AutomationsSection.tsx`, `ui/src/SettingsPage.tsx` | The plan-usage source list is empty and the usage tabs accept a readonly array. | TNT has no account plans; a frozen readonly empty list is the honest answer. | `usageCodingPlanSources`, `SettingsUsageProviderTabs`. |
| `shared/src/automation-types.ts`, `services/src/zcode-agent/{zcodeAgent,zcodeAgentService,zcodeAgentPluginParams}.ts`, `ui/src/v4/{tntWorktreeSend.ts,SessionPane.tsx,V4ChatPane.tsx,V4WorkspaceChatArea.tsx,WorkbenchPane.tsx}`, `ui/src/app-shell/WorkspaceShellLayout.tsx`, `ui/src/GitBranchSwitcher.tsx`, `ui/src/tnt-worktree/*` | Managed worktrees (docs/git/worktree.md v1, TNT mapping): a right-end `h-7` bordered pill on the draft composer header, the existing branch capsule records the checkout ref instead of switching the checkout when enabled, and the first send creates the worktree plus a session whose cwd is that worktree. | ZCode's feature is desktop-only and its source is not in the reference checkout; TNT's engine registry already treats every workspace path as a session cwd, so the doc's behaviour maps directly. | `IZCodeAgentService.createManagedWorktree/listManagedWorktrees/removeManagedWorktree/managedWorktreeAvailable`; `webuiZcode/services/managedWorktree.ts`; `sendDraftIntoManagedWorktree`. |
| `ui/src/components/workflow-timeline/WorkflowRunDigest.tsx` | The `wf-digest-plot` container is a one-row CSS grid (`grid` class plus `gridTemplateRows: timelineHeight(shown) + 8px`) instead of an inline fixed `height`. | Layout fix: the digest plot needs an explicit grid row track so the timeline SVG keeps its computed height inside the digest card. | `wf-digest-plot` styling; run digest plot in the workflow timeline. |

The remaining UI source is the upstream tree verbatim; changes to it must be recorded in
this table and paired with a test.

## Rules

- A divergence must be paired with a test on the TNT side or the vendored package side.
- Protocol additions belong in `@zcode/shared` schemas first, then the UI component, then
  the TNT producer; never let only one of the three change.
- No synthetic values: if the side has no data, the component renders nothing for that
  field rather than a placeholder.
