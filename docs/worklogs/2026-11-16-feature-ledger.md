# 功能补记（2026-11-14 至 2026-11-16）

此前批次的部分功能没有单独记录，这里按「功能 + 涉及文件 + 状态」补齐，便于后续核验。全部为已实现。

## 运行时上下文注入

- 功能：每条用户消息附带本地时间、时段、上下文窗口用量与当前运行的子代理／团队状态。各段只在其数据可信时出现；用量取 provider 上一次请求的实测值，不做逐条重数。
- 文件：`packages/cli/src/subagent/runtimeContextNote.ts`、`packages/cli/src/subagent/liveRuns.ts`、`packages/cli/src/subagent/executor.ts`、`packages/cli/src/commands/chat.ts`、`packages/cli/src/ui/hooks/useChat.ts`、`packages/cli/src/commands/serve.helpers.ts`。

## 定时任务后端与 Workflow 页签

- 功能：WebUI 设置页的定时任务具备创建、启停、改配置、立即运行、历史与删除；30 秒调度器领取到期与手动任务并经 V4 命令派发。工作流页签列出 team run 的状态、可恢复性、标签与时间。
- 文件：`packages/cli/src/webuiZcode/services/automations.ts`、`packages/cli/src/webuiZcode/services/workflowRuns.ts`、`packages/cli/src/appServer/workflowRunSummaries.ts`、`packages/cli/src/appServer/workflowRuns.ts`、`packages/cli/src/appServer/v4.ts`、`packages/cli/src/appServer/protocol.ts`、`packages/zcode-ui/shared/src/automation-types.ts`、`packages/zcode-ui/services/src/zcode-agent/zcodeAgent.ts`、`packages/zcode-ui/services/src/zcode-agent/zcodeAgentService.ts`、`packages/zcode-ui/ui/src/settings/AutomationsSection.tsx`、`packages/zcode-ui/ui/src/settings/saved-workflows/WorkflowRunsSection.tsx`。

## 受管 worktree 与草稿开关

- 功能：对话框上的 worktree 胶囊开关按工作区路径读写草稿状态；分支胶囊记录检出点而不是执行分支切换；勾选后首条消息在受管 worktree 的 cwd 中创建会话。创建路径忽略文件复制、symlink 父目录守卫与冲突重试。
- 文件：`packages/cli/src/webuiZcode/services/managedWorktree.ts`、`packages/zcode-ui/ui/src/tnt-worktree/draftWorktreeStore.ts`、`packages/zcode-ui/ui/src/tnt-worktree/TntWorktreeToggle.tsx`、`packages/zcode-ui/ui/src/v4/tntWorktreeSend.ts`、`packages/zcode-ui/ui/src/GitBranchSwitcher.tsx`、`packages/zcode-ui/ui/src/app-shell/WorkspaceShellLayout.tsx`、`packages/zcode-ui/ui/src/v4/SessionPane.tsx`。

## 原生目录选择器

- 功能：WebUI「选择文件夹」调用系统文件管理器（zenity / kdialog / yad），取消与故障分开处理，缺工具时尝试下一个；请求为本地 POST 路由，不发起外部 URL 请求。
- 文件：`packages/cli/src/services/webuiNativeDirectory.ts`、`packages/cli/src/services/WebUiService.ts`、`packages/zcode-ui/web/src/platform/index.ts`。

## 部署缓存与文档站链接

- 功能：WebUI 的 index.html 与 SPA 回退均带 `Cache-Control: no-store`，避免重新部署后浏览器继续用旧 bundle。文档站内部链接统一带部署子路径前缀；跳转目标校验为 http/https，拒绝环回、私有与保留地址。导航页面与文档内链在构建前检查。
- 文件：`packages/cli/src/services/webuiStatic.ts`、`docs-site/components/docs/mdx/MdxLink.tsx`、`docs-site/lib/redirectHost.ts`、`docs-site/lib/docs.ts`、`docs-site/scripts/check-docs-links.ts`、`docs-site/app/[[...slug]]/page.tsx`、`docs/docs.json`、`docs/docs.zh.json`。

## 致谢与开源声明

- 功能：README 声明未发布 npm 包、安装走 Release 压缩包；中英双语致谢页列出基座、WebUI、输入组件、工具机制设计调研与插件格式的来源链接。
- 文件：`README.md`、`docs/acknowledgements.mdx`、`docs/zh/acknowledgements.mdx`、`packages/cli/BUILD.md`、`skills/tnt-review/SKILL.md`、`packages/zcode-ui/NOTICE.md`、`packages/zcode-ui/THIRD-PARTY-NOTICES.md`、`packages/zcode-ui/UPSTREAM-DIVERGENCES.md`。

## 版本与发布

- 功能：CLI 包版本为 0.0.1；发布工作流为四个平台产出 tarball，Windows tarball 内为 Windows 原生 sqlite3 与 JS，需要 Node 24 与 `node package/dist/tnt.js` 启动（无 exe/cmd 启动器）。
- 文件：`packages/cli/package.json`、`.github/workflows/release.yml`、`packages/cli/scripts/install.ps1`、`packages/cli/scripts/install.sh`、`README.md`。

## CI 门禁修复（11-16 批）

- 功能：三个 CI 作业在 lint／test／smoke-api 前先构建 vendored ZCode UI 包；测试用例对 Windows 临时目录清理与 e2e 断言形态做跨平台兼容；CLA 作业跳过 Bot 发起的 PR。
- 文件：`.github/workflows/cli-pr-checks.yml`、`core/util/safeTarball.vitest.ts`、`packages/cli/src/services/webuiNativeDirectory.test.ts`、`packages/cli/e2e/resume-flag.test.ts`、`packages/cli/e2e/headless-mock-llm.test.ts`、`.github/workflows/cla.yaml`。
