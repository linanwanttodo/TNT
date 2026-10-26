# TNT TUI 差距分析报告（对比 test-continue 参考库）

- 日期：2026-10-25
- 对比对象：TNT `packages/cli` vs 参考库 `test-continue/` 下的 omp（重点）、gemini-cli、opencode、codex、claude-code（重建树）、Open-ClaudeCode
- 方法：两路并行探查（omp 全量盘点 + 四项目对照）+ TNT 现状人工盘点；所有结论带文件路径证据
- 范围：用户可见/可摸的 TUI 能力。CI/文档/安全已在上一份 `QUALITY-AUDIT-REPORT-2026-10-24.md` 处理，不重复

---

## 0. 总览

| 能力域           | TNT 现状                   | omp                                                      | gemini-cli                     | opencode                               | codex                             | claude-code                           |
| ---------------- | -------------------------- | -------------------------------------------------------- | ------------------------------ | -------------------------------------- | --------------------------------- | ------------------------------------- |
| 主题数量         | 3 套（内置对象）           | **102 套 JSON** + 自定义目录 + watcher 热重载            | 19 套 + 用户自定义 + ANSI 降级 | ~30 套 JSON + system 现场生成          | 6 套 .tmTheme + 用户目录          | 6 套 + auto                           |
| 主题切换 UI      | 无（改配置重启）           | overlay 实时预览                                         | Dialog 高亮即预览              | 对话框实时换肤                         | /theme live preview               | usePreviewTheme 三段式                |
| auto 明暗适配    | 无                         | ✅ 终端外观探测                                          | ✅ 背景色亮度判定              | ✅ OSC palette 生成                    | ✅ is_light 切换                  | ✅ OSC 11 查询                        |
| 符号集系统       | 无（glyph 硬编码在各组件） | **200 键 × 3 preset**（unicode/nerd/ascii）              | 无                             | 无                                     | 无                                | 无                                    |
| diff：词级高亮   | ✅（jsdiff）               | ✅ + 语法高亮                                            | ❌（行级+语法）                | ✅（tree-sitter）                      | ❌（行级+语法）                   | ✅（Rust 侧）                         |
| diff：语法高亮   | ❌                         | ✅                                                       | ✅（lowlight 逐行）            | ✅                                     | ✅（syntect 整 hunk）             | ✅                                    |
| diff：全屏浏览器 | 简单 overlay               | transcript 浏览器                                        | ❌                             | **split/unified + 文件树 + hunk 导航** | ❌                                | /diff 两级浏览                        |
| 输入：多行/历史  | ✅ 历史↑↓                  | ✅ + vim 模式 + kill-ring                                | ✅ + vim + 大粘贴折叠          | ✅ + 草稿 stash                        | ✅ + 跨会话持久历史               | ✅ + Ctrl+R 搜索                      |
| 输入：粘贴增强   | 图片粘贴 ✅                | 附件 chips                                               | 大粘贴折叠占位符               | 图片内联预览                           | HTML/图片管道                     | 粘贴处理                              |
| 审批 UI          | 单一 yes/no 选择器         | 阻塞卡 + 选择 overlay                                    | **确认队列**                   | ❌                                     | **审批模态 + 快捷键**             | **30+ 每工具定制组件**                |
| 流式平滑         | 整帧重渲                   | **30fps 字素级揭示**                                     | 结构分区（Static）             | batch() 成帧                           | 帧                                |
| 率钳制           | —                          |
| 状态栏段数       | ~6 段（固定）              | **23 段 + preset 可配**                                  | 固定                           | 固定                                   | 双行 footer                       | 固定                                  |
| 其他             | 点击区域、i18n 双语        | 60+ overlays、OSC8 超链接、kitty 图片、DECCARA、桌面通知 | 设置对话框、对话框栈           | 命令面板、插件化 sidebar、会话 tabs    | Ctrl+T 转录、鼠标文本选择、无障碍 | 全局搜索、键位系统+冲突检测、虚拟滚动 |

---

## 1. 主题体系（差距最大、最值得投入）

**TNT 现状**：`theme/tokens.ts` 三个内置对象（dark / tencent-dark / tencent-light，"light" 是别名），`config.theme` 或 `TNT_THEME` 启动时选定，无运行时切换；token 是固定 interface（text/status/border/accent/tool/diff 七组）；glyph（☑ ☐ ├─ │ 等）硬编码在各组件；`SyntaxHighlighter` 的代码块配色是独立硬编码 ANSI 色（`defaultTheme`：magenta/green/gray…），**与主题体系完全脱钩**——切主题后 markdown 代码块颜色不变。

**参考库做法**：

- omp：主题是 JSON 文件（`vars` 调色板 → ~90 个语义 token → terminal 色），schema 校验；**200 个符号键**分 3 套 preset（unicode/nerd/ascii），主题可逐键覆盖；`setTheme/previewTheme` 分离 + 终端外观探测自动明暗 + 自定义目录 watcher 热重载 + 色盲模式（HSV 把 diff 绿移向蓝）
- gemini-cli：`theme-manager.ts` 单例 + 用户自定义主题加载 + `matchThemeBackground` 按终端背景亮度 auto 选 dark/light；`ThemeDialog` 高亮即实时预览（含代码/diff 预览块）
- opencode：主题 JSON schema 最细（v2 含 light/dark 双模式、syntax__/markdown__/diff_* 分组）；`system.ts` 从终端 OSC palette **现场生成整套主题**；`dialog-theme-list` 光标移动即换肤、Esc 恢复
- claude-code：`Theme` 80+ 语义字段（含 `diffAddedWord/diffRemovedWord` 词级色、色盲变体）；`systemTheme.ts` OSC 11 查询 + `$COLORFGBG` 预填
- codex：syntect .tmTheme 语法主题 + `theme_picker` live preview；按终端色阶量化取色

**建议（按投入产出排序）**：

1. **P0 - auto 明暗适配**：OSC 11 查询终端背景色（`$COLORFGBG` 兜底）→ 亮度判定 → 选 dark/light。四家全有、感知最强、纯 stdout 写入即可实现，Ink 无阻碍
2. **P0 - 代码块配色接入主题**：把 `SyntaxHighlighterTheme` 变成 Theme 的一个 token 组（每主题给 syntax 色），消灭"切主题代码块不变色"的脱钩——半天工作量，一致性收益立竿见影
3. **P1 - /theme 切换对话框**：列出内置主题、光标移动即预览、Esc 回滚、Enter 写配置。四家一致的模式，TNT 有 3 套主题却没入口
4. **P2 - 主题外置**：语义 token 扩展（syntax*/md* 组）+ JSON 主题目录 + 热重载（照搬 omp 的 schema 思路）
5. **P2 - 符号 preset**：把散在各组件的 glyph 收进 symbols 表（unicode/nerd/ascii 三 preset），顺带解决 nerd font 用户的需求

## 2. Diff 渲染

**TNT 现状**：`ColoredDiff.tsx`（词级高亮 + 行号，16 行截断，用于 diff overlay）、`ToolDiffView.tsx`（折叠/展开 + hunk 行，用于工具输出）。无语法高亮、无文件名/统计头、无全屏导航。

**参考亮点**：

- omp `chrome/diff.ts`：词级 diff + 反色高亮 + **上下文行按文件语言语法高亮** + tab/空格缩进可视化 + 行号槽定宽保证流式字节稳定
- codex `diff_render.rs`：syntect 按 hunk 整块高亮（**保留跨行解析状态**——多行字符串/块注释不着错色）+ 长行按字符边界硬换行保留样式
- opencode：split/unified 双视图 + 文件树侧栏 + hunk 导航 + >3000 行分块虚拟化
- claude-code：/diff 命令两级浏览（本轮 diff 列表 → 详情）

**建议**：

1. **P0 - diff 语法高亮**：TNT 已有 lowlight 依赖（gemini 同款路线），按文件扩展名对上下文行着色，接进 `ToolDiffView`/`ColoredDiff`——这是"diff 丑"观感的另一半来源
2. **P1 - diff 卡片头部**：`✓ Edit: src/math.ts · +12 -3`（统计已有 `getDiffSummary`，只差展示）+ 文件名显示
3. **P2 - 全屏 diff 模式**：现有 DiffViewer overlay 扩展成 split/unified + hunk 跳转（opencode 是参照）
4. **P2 - 长行硬换行**（codex 的字符边界换行保留样式，避免窄终端丢内容）

## 3. 输入编辑器

**TNT 现状**：单行为主、历史↑↓、@ 文件搜索、斜杠面板、图片粘贴（imageMap）。

**参考亮点**：gemini `text-buffer.ts` 的**大粘贴折叠成 [Pasted Text] 占位符（可展开）+ 粘贴路径自动转 @ 引用**；codex/claude-code 的 Ctrl+R 历史搜索与跨会话持久历史；opencode 的草稿 stash；omp 的 vim 模式与附件 chips。

**建议**：

1. **P1 - 大粘贴折叠**：超阈值粘贴折叠成占位符（可展开）——直接解决"贴 200 行日志把屏刷爆"
2. **P1 - Ctrl+R 历史搜索**（claude-code `HistorySearchInput` 是 Ink 同栈实现参照）
3. **P2 - 草稿 stash**（切会话/清屏时暂存未发送输入）

## 4. 审批/确认 UI

**TNT 现状**：`ToolPermissionSelector` 单一选择器。

**参考亮点**：claude-code 30+ 每工具定制审批组件（bash/apply-patch/退出 plan 各有专属卡）；codex `approval_overlay` 决策显式回发 + 快捷键；gemini `ToolConfirmationQueue` 多审批排队。

**建议**：**P1 - 审批卡升级**：bash 命令审批显示完整命令 + 工作目录，edit 审批内嵌 diff 预览（数据流已有，纯展示层）；多请求排队展示。

## 5. 流式渲染

**TNT 现状**：流 chunk 直接 setState 整帧重渲（有 memo 兜底）。

**参考亮点**：omp `streaming-reveal.ts` **30fps 字素级渐进揭示**（自适应步长 + LRU 缓存，避免逐 token 全树遍历）；gemini 的 Static 分区；opencode 的 batch() 成帧。

**建议**：**P2**。TNT 刚落地的 wheel 帧批处理解决了滚动侧；流式文本侧的字素揭示是锦上添花，建议等真实卡顿出现再做（Ink 整帧渲染模式下需先自建节流层）。

## 6. 其他值得记下的（P2/观察）

- **命令面板**（opencode `command-palette.tsx`，fuzzy 搜索所有动作）
- **键位系统**（claude-code KeybindingContext + 冲突检测；TNT 快捷键分散硬编码）
- **消息虚拟滚动**（claude-code VirtualMessageList；TNT 的行窗方案已部分覆盖）
- **OSC 8 文件路径超链接**（omp `render/hyperlink.ts`，不支持时降级——成本低）
- **桌面通知**（长任务完成 BEL/notify-send）
- **Ink fork 诱惑**（Open-ClaudeCode 的自研 ink 运行时）——上份报告已定为反模式，维持不改

## 7. 已闭环（本次核对确认，勿重复投入）

滚动条列（transcript + 会话选择器双栏）、wheel 帧批合并、`/clear` transcript remount、会话预览可滚动、TODO 树形面板（单竖线 + 5 条上限 + 完成隐藏）、GOAL 视觉统一、**工具调用边框卡片**（本轮：圆角框 + 状态色边框 + 标题嵌顶栏 + `· 摘要` + `(时长)` 尾行，3407 测试全绿）。

## 8. 建议执行顺序

| 批次     | 内容                                                                                         | 量级   |
| -------- | -------------------------------------------------------------------------------------------- | ------ |
| **P0-a** | 代码块配色接入 Theme（消灭脱钩）+ diff 语法高亮（lowlight 逐行）                             | 1 天   |
| **P0-b** | auto 明暗适配（OSC 11 + COLORFGBG 兜底）                                                     | 半天   |
| **P0-c** | /theme 切换对话框（实时预览 + Esc 回滚）                                                     | 1 天   |
| **P1**   | diff 卡片统计头 + 审批卡升级（bash 完整命令 / edit 内嵌 diff）+ 大粘贴折叠 + Ctrl+R 历史搜索 | 2-3 天 |
| **P2**   | 主题 JSON 外置 + 符号 preset + 全屏 diff + 流式揭示 + 命令面板                               | 按周排 |

每批独立 commit；P0 三项做完后，"diff 丑 / 主题死"这两个观感问题基本清零。
