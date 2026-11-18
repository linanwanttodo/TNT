# WebUI 接线修复（2026-11-18）

本文件记录 TNT WebUI 相对 ZCode 上游交互差异的三处修复，以及验证方式。扫描/复现环境：
`packages/cli/dist/tnt.js webui --no-open` 起在隔离的 git 工作区 `/tmp/tnt-webui-ws`，
Playwright（chromium headless，`~/.npm/_npx/e41f203b7505f1fb`）驱动真实点击。

## 1. 自动化任务「历史」点击报错（已修复）

- 根因：`packages/cli/src/webuiZcode/serviceCollection.ts` 的
  `ZCODE_LOCAL_SERVICE_ACCESSORS` 没有 `IOffPeakTaskService` 条目；这个必需通道
  落到了 `stubService()`，每次调用都 reject `ZCODE_UNAVAILABLE:...`。而
  `AutomationsSection` 的定时任务 历史/取消/暂停/删除 直接使用
  `useServices().offPeakTaskService`（`offPeakCancel`、`offPeakDelete`、
  `offPeakDeleteHistory`、`offPeakRefresh` 全部走它），点击后 toast 出错误。
  定时任务列表、工作流历史以外的卡片操作同样受影响。
- 修复：新增 `webuiZcode/services/offPeakTask.ts` —— 把 TNT 自己的 cron
  automation 后端（`automations.ts`）适配成 `IOffPeakTaskService`：
  - `list()` / `get()` 把 `ZCodeAutomation` 映射成 `ZCodeOffPeakTask`：只映射
    实际存在的字段（title/prompt/workspace/status/时间/错误），ticket 与队列
    字段保持 undefined，不伪造（遵守 vendored 规则「无数据不渲染占位值」）；
  - 取消/暂停 → `setAutomationEnabled(false)`，继续 → `enabled: true`，删除 →
    `deleteAutomation`，更新 → `updateAutomation`；id 操作先按 id 找到任务，再
    用任务自己记录的 workspace 作用域调用后端；
  - `getCodingPlanSupport()` 诚实返回 `supported:false / connection_unavailable`
    （TNT 没有 ZCode coding plan / ticket 服务器），取号入口因此置灰；
    `createTask()` 稳定拒绝并指向 automation 创建页；`deleteHistory()` 接受但不
    隐藏（TNT 的 run 由保留策略裁剪，没有 historyDeletedAt 标记）。
- 接线：`buildZcodeServiceCollection` 只创建一份 `createZcodeAutomationBackend`
  并同时交给 `createZcodeAgentService`（避免两个调度器抢同一 sqlite 库）和
  适配器；`serviceCollection.test.ts` 的真实通道集合补上 off-peak 通道。
- 测试：`offPeakTask.test.ts` 4 例（字段映射、无 ticket 伪造、无后端时诚实
  拒绝、取消按任务作用域禁用、终态/失败/暂停状态）；`src/webuiZcode/` 全套
  120 例。

## 2. worktree 按钮点击效果与 ZCode 不一致（已修复）

- 现象：勾选 worktree 胶囊后，旁边的分支胶囊换成「记录检出 ref」模式，下拉
  底部显示「新 worktree 将从所选分支创建，不切换本地分支」，点分支不切分支。
  这不是 ZCode 的交互。
- 修复：`ui/src/GitBranchSwitcher.tsx` 移除 `worktreeMode` /
  `worktreeSelectedRef` / `onWorktreeRefSelect` 三条 TNT 专用分支，胶囊恢复原生
  `switchBranch()`；`app-shell/WorkspaceShellLayout.tsx` 不再传入这些 props，
  分支菜单的 footer 操作在任何模式下都显示；`tnt-worktree/TntWorktreeToggle.tsx`
  注释更新。worktree 在首次发送时从「当前检出」创建（draft 的 ref 字段保留但
  不再由 UI 写入），与 ZCode 的「worktree 从当前分支切出」一致。
  `UPSTREAM-DIVERGENCES.md` 的 worktree 行同步更正。
- 验证：Playwright 实测 —— 胶囊可见可勾选；勾选后分支下拉不再出现 ref 提示，
  点分支走原生切换；首发后 `.tnt/worktrees/<hash>/<project>` 作为真实 git
  worktree 被创建（detached HEAD）且会话在该 cwd 打开。scratch 环境的
  「发送失败」来自模型指向 `127.0.0.1:9` 的故意不可用端点，与 worktree 链路无关。

## 3. 工作流 tab 空白（已修复）

- 根因：`webuiZcode/services/workflowRuns.ts` 用
  `meta.workspaceDirectory !== options.workspacePath` 精确字符串过滤；从项目
  子目录开过的会话（或路径写法不同的会话）全部被排除，用户明明跑过 team
  运行，列表仍显示「这个工作区还没有跑过工作流」。
- 修复：`belongsToWorkspace()` 改为路径归一化后的相等或包含判断（`root` 本身或
  `root + sep` 前缀），拒绝同名前缀兄弟目录（`/ws-other` 不算 `/ws`）。
- 测试：`workflowRuns.containment.test.ts` 3 例（根/子目录/尾斜杠、兄弟与
  外部路径排除、未指定 workspace 时全收）。

## 验证汇总

- cli：`npm run lint`（tsc + eslint）干净；`npx vitest run` 全量 5300+ 用例；
  `src/webuiZcode/` 120 例；`i18n/untranslatedOutput.test.ts` 的 raw-throw
  计数按新增两条协议级拒绝消息登记（48 → 50）。
- ui：`npx tsc -b` 干净、`npx vitest run` 16 例。
- 打包：`npm run build`（cli + webui）成功；dist 同步到
  `~/.tnt/cli/package/dist` 后 `~/.local/bin/tnt` 即拿到全部修复。

## 边界

- off-peak 的云端 ticket / coding-plan 灰态是 TNT 的诚实缺失，不是等待接通；
  定时任务本体走 TNT 的 cron automation 后端，创建页仍在「创建定时任务」菜单。
- 分支切换是宿主机器上的 git 操作；LAN 明文 http 不是安全上下文，
  `secureContext.ts` 的 polyfill（并行流修复）保证 id/hash 生成可用。
