# ZCode 桌面端界面 → TNT WebUI 1:1 搬运计划

## 源与目标

- **源（搬运对象）**：`/home/lin/All_projects/GithubProjects/test-continue/ZCode/packages/ui`
  - React + Tailwind v4（`@tailwindcss/vite`），入口 `src/App.tsx`，全局样式 `src/styles.css`
  - 主题系统：`src/useTheme.ts`；布局壳：`DesktopWindowFrame.tsx`、`DesktopTopOverlay.tsx`、`project-sidebar/`、`workspace-grouped-tasks/`、`sidebar-activity/`
  - 会话流渲染：`src/components/`（消息、轨迹卡、错误条 `ChatErrorBanner.tsx`、思考流、工具卡）
  - 输入区：`src/LexicalChatInput.tsx`（Lexical 富文本）——**不搬**，按用户要求保留 TNT 现有输入框
- **目标**：`packages/cli/webui`（React 19 + Vite + CSS Modules；会话数据在 `src/stores/session-store.ts`，API 在 `src/api/`）

## 搬运规则（用户裁决：原模原样）

1. JSX 结构、className、DOM 层级、样式值**逐字照抄** ZCode 源码，不改设计。
2. 只允许三处适配：import 路径、数据 props 接线、i18n 文案层。
3. 数据层一律用 TNT 现有 `session-store` / `api` 客户端，不引入 ZCode 的 rpc/client 层。
4. 保留 TNT 的 Composer 输入框（用户豁免项），但外层容器样式对齐 ZCode 布局。

## 分阶段执行

### P1 地基

- 安装 `tailwindcss @tailwindcss/vite`，在 `webui/vite.config.ts` 挂插件
- 拷贝 `packages/ui/src/styles.css` → `webui/src/ui/zcode/styles.css`，`main.tsx` 引入
- 拷贝 `useTheme.ts` + 主题 token，接入 TNT 现有主题切换

### P2 布局壳（App.tsx 结构）

- 按 `packages/ui/src/App.tsx` 的布局树搭 `webui/src/App.tsx`：侧栏（`project-sidebar` + `workspace-grouped-tasks`）+ 主区（`DesktopTopOverlay` + 会话流）+ 底部输入区
- 会话列表接线 `session-store` 的 sessions 拉取；新建会话、切换会话走现有 API

### P3 会话流（消息渲染）

- 逐个搬运消息组件：用户消息、助手正文（markdown 主题）、思考流（Reasoning）、工具/轨迹卡、`ChatErrorBanner`
- 映射：TNT `ChatView/ChatItemView/TrajectoryView/ReasoningRow` 的数据字段 → ZCode 组件 props；DOM/className 不改

### P4 输入区

- TNT Composer 保留逻辑，外壳套 ZCode 输入区容器样式

### P5 加载占位修复

- `ChatLoading` 只允许出现在"会话为空且无任何用户消息"时；用户发出消息后立即渲染用户消息 + ZCode 式的流式进行中状态，不再显示整屏加载提示

## 验证

- `npm run build`（tsc + vite）+ `npx vitest run`（webui）
- 每阶段完成后对照 ZCode 截图/源码走查 DOM 结构一致性
