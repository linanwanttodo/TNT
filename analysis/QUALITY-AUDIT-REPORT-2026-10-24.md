# TNT 质量检测及优化报告

- 日期：2026-10-24
- 范围：`packages/cli`（产品主体）、`core/`、`packages/*`、`docs/` + `docs-site/`、`.github/workflows/`；`ide/`（vscode/intellij/gui）按"冻结待重构"对待
- 方法：三路专项分析（CI / 文档 / 参考库 test-continue）+ mimosa 深度安全扫描（静态、无运行时执行）+ 本地静态检查（vitest / tsc / eslint / prettier）+ TUI 源码人工审查
- 本报告只分析不改代码。所有结论均带 `文件:行号` 证据，供下一步决策。

---

## 0. 总体结论（TL;DR）

| 维度         | 状态     | 一句话                                                                                                    |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| 工程底子     | ★★★★☆    | 3369 个单测全过、tsc 0 错、架构文档严格（数字可复现），底子好                                             |
| TUI 闪屏     | 已定位   | 四个根因全部找到（见 §2.1），修复路径清晰，参考库有同构实现可搬                                           |
| 侧边栏滚动条 | 已定位   | 主界面无侧栏；`/sessions` 双栏的右预览完全不可滚动（见 §2.2）                                             |
| CI           | 需要收编 | 35 个 workflow，约 1/3 是 IDE 相关、约 1/3 是 Continue 遗留设施，真正服务 TNT 的只有 6-7 个（见 §3）      |
| 文档         | 中等偏差 | `docs/cli/` 19 页（中英对齐）质量好；债集中在 13 个未进导航的 Continue 时代旧页 + 3 个命令级错误（见 §4） |
| 安全         | 主体可控 | 534 条静态发现中 72% 在冻结的 IDE 目录；产品主体抽查后 3-4 个值得处理（见 §5）                            |
| 注释卫生     | 待清洗   | 借用注释含 "pi" 7 处、"Claude Code" 6+ 处，违反移植规则（见 §2.4）                                        |

**建议的动手顺序**（§7 有完整版）：先做零风险的卫生批（注释清洗 + eslint/prettier 一键修）→ CI 收编（关 IDE、删遗留）→ 文档 P0 六条 → TUI 方案 A（闪屏 + 滚动条）→ serve 鉴权。

---

## 1. 检测数据总览

- **单元测试**：419 个文件、3374 个用例，**3369 通过 / 5 跳过 / 0 失败**（54s）。
- **类型检查**：`tsc --noEmit`（packages/cli）**0 错误**。
- **ESLint**：**10 个错误**，全部是 `import/order`（6 个可 `--fix` 自动修复）。
- **Prettier**：**7 个文件**不符合格式（e2e 3 个、`src/ui/LoadingAnimation.tsx`、`src/ui/SlashCommandUI.tsx`、`test-utils/TUIChat.testHelper.ts`、`native/win32/build.mjs`）。
- **TODO/FIXME**：源码内真实 TODO 约 15 处，多为清理性质（如 `useChat.stream.helpers.ts:154` "TODO service should always be ready, get rid of this code"）。
- **安全扫描**：mimosa deep，534 条（high 350 / medium 183 / low 1），报告存于
  `~/.mimosa/security-scans/project-35e25592ebf4e5ae69208498/scan-2026-10-24T12-53-37.927Z-bdcf133c08f8/report.md`（seal: `sha256:ab63f793…553700`）。
- **仓库卫生**：`packages/cli/` 根目录躺着 7 个历史版本 tar.gz（v1.0.0–v1.0.6，约 350MB）已提交入库；`upstream`（continuedev/continue）从未 fetch，无法直接 diff 与上游差异。

---

## 2. TUI 专项：闪屏 + 侧边栏

### 2.1 闪屏根因（按证据链）

当前实现：主界面是备用屏（alternate screen）里的全高 Ink 帧，transcript 区 `TranscriptContent` 把**全部历史消息**渲染进一个 `ScrollView`，滚动靠负 margin 平移（`ScrollView.tsx:60-67`）。四个根因：

1. **没有 Ink `<Static>` 分区，滚动 = 整帧重写**。Ink 每帧重画整个视口且不做行级差分；scrollTop 每变一行，视口内所有行内容都变，Ink 就全量重写整个 transcript 区域。滚轮连续滚动时每秒多次全屏重写，表现为闪屏。全 ui 目录没有任何 `<Static>` 用法（已 grep 验证）。
2. **每次渲染都全量测量并触发二次渲染**。`ScrollView.tsx:40-49` 的 `useLayoutEffect` **没有依赖数组**，每次渲染都跑 `measureElement` 并回调 `onMetrics`；`useChatViewport.ts:70-85` 在 metrics 变化时 `setState` → 再渲染一遍。这是有意设计（`useChatViewport.ts:63-66` 注释），但意味着每个滚动步、每个流式 chunk 都至少两轮渲染。
3. **没有帧合并**。每个滚轮事件（`useChatViewport.ts:158-169`）和每个流式 chunk 都直接 `setState` 触发 Ink 渲染。`WheelScrollAccelerator`（`utils/wheelScroll.ts`）只调整步长，不合并频率。
4. **手动清屏绕过 Ink 渲染管线**。`TUIChat.tsx:200-202` 的 `resetTranscript` 直接 `process.stdout.write("\x1b[2J\x1b[H")`，与 Ink 的帧状态失同步——`/clear`、加载会话（`TUIChat.tsx:336`）、reload（`useChatHandlers`）时的白屏闪烁即来源于此。

### 2.2 侧边栏滚动条

先澄清概念：主聊天界面**没有侧边栏**（`TUIChat.tsx:442` 单列布局）。唯一的双栏界面是 `/sessions` 会话选择器，两个面板都有问题：

- **左栏（会话列表）**：没有滚动条，只有两行文字提示（`SessionSelector.tsx:142-146` "N more above"、`:177-182` "⬇ N more sessions below..."）；可视条目数用 `MAGIC_NUMBER = 9` 硬猜（`SessionSelector.tsx:73`）。
- **右栏（SessionPreview 预览面板）**：**完全不可滚动**。只显示前 N 条消息 + 固定一行 "... and X more messages"（`SessionPreview.tsx:87-110`）；N 按"每条消息 4 行"猜测（`:63-68`）；消息内容截断到 150 字符（`:92-95`）。长会话的老消息永远看不到。

### 2.3 修复方案（两个选项，供拍板）

参考库 `test-continue` 已完成同构实现调研（gemini-cli 同为 Ink；pi/omp 纯 TS 可整段移植），材料与文件级落点如下：

**方案 A：增量修补（保留 alternate screen + ScrollView 架构，推荐先做）**

1. **帧合并 hook**：移植 pi 的 16ms 帧合并模式（`test-continue/pi/packages/tui/src/tui.ts` 的 `requestRender/requestImmediateRender/scheduleRender`，纯逻辑约 40 行），包成 hook 用于滚动与流式 state 更新，把"每事件一渲染"压到 ≤60fps。
2. **滚动输入按 tick 合并**：移植 gemini-cli 的 `useBatchedScroll`（纯 React hook，同 tick 多次滚动合并为一次渲染后复位）。
3. **行窗虚拟化**：ScrollView 只渲染可见窗口 ± 缓冲（参考 opencode 的 `mount-budget.ts`：首屏挂尾部 40 行、上滚按 60 行回填；opencode 是 SolidJS 但算法是纯函数）。这同时消解根因 1 和 2 的大半成本。
4. **滚动条列**：移植 pi/omp 的滚动条几何（`pi/packages/tui/src/components/scroll-view.ts` 的 `scrollbar: "auto"` 状态机 + `layout.ts` 的 `getScrollbarGeometry/paintScrollbar` 比例算法；omp 的 `scroll-viewport.ts` 把 viewport 数学抽成了可单测纯函数，可连同测试一起搬）。落地为 ScrollView 最右列自绘 `│`/`█`，同时用于 `/sessions` 两个面板（预览面板改为可滚动 + 带滚动条）。
5. **resetTranscript 收编进 Ink**：改为组件级重挂载或用 Ink 自己的 clear 路径，消除手动 `\x1b[2J` 与帧状态的竞争。

**方案 B：结构性改造（Static 定稿历史 + 原生 scrollback）**

- 抄 gemini-cli 三件套：流式 chunk 经 `findLastSafeSplitPoint`（保证切点不落在未闭合代码围栏内）切分，定稿历史进 `<Static>`、最后一条回答留实时区（`test-continue/gemini-cli/packages/cli/src/ui/hooks/useGeminiStream.ts` + `components/MainContent.tsx` + `AppContainer.tsx` 高度预算）；
- 退出 alternate screen，回到终端原生 scrollback（codex `insert_history.rs`、reasonix 都把原生 scrollback 当首选，与 Ink `<Static>` 同构）。
- 收益是整类滚动问题消失、体验与主流 CLI 对齐；代价是改动面大（viewport/点击/鼠标事件都要重做）。**注意**：`test-continue/REFERENCE_REVIEW_TNT.md` 第 11 节已有此方向的批次规划，但其"现状"描述已过时——文档提到的 `StaticChatContent.tsx` 在当前代码中**不存在**（旧状态描述），动手前需以本报告 §2.1 为准。

**两个方案共同的反模式**（参考库文档与源码双重确认）：

- 不要引入 ink fork（`@jrichman/ink`、`@ant/ink`）来获得虚拟列表/backbuffer；
- 不要靠节流治闪（gemini-cli 全仓无 app 层节流，靠结构：memo + 稳定 key + Static 分区）。

### 2.4 移植卫生规则（用户已定，现状违反中）

规则：参考代码可以直接搬，但**注释/说明不得出现 cursor、pi、gemini 这类字样**。现状盘点：

- "pi" 直接引用 **7 处**：`ui/hooks/useChatViewport.ts:54,108`、`ui/utils/wheelScroll.ts:7`、`ui/components/ToolGroupDisplay.tsx:31,198,246`、`ui/LoadingAnimation.tsx:12`（均为描述性注释，改动零风险）。
- "Claude Code" 引用 **6+ 处**：`hooks/hookConfig.ts:4,9,45`、`ui/reasoningFold.ts:8`、`hooks/hookRunner.ts:124` 等。注意其中 `hookConfig.ts:10-12` 的 `~/.claude/settings.json` 是**功能性兼容路径**（读取 Claude Code 格式的配置文件），路径本身不能删，只需注释改为"兼容外部 agent 配置格式"之类中性表述。
- 建议：这批清洗作为第一个 commit（纯注释/文案，无行为变化，CI 全绿即可合）。

---

## 3. CI 专项

### 3.1 全景分类（35 个 workflow + 2 个模板 json）

**A. 保留并优化（TNT 主链，6 个）**

| Workflow                                                                                    | 作用                                                                                           | 问题                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli-pr-checks.yml`                                                                         | CLI PR 门禁：lint + test 矩阵 + smoke-api                                                      | ① test 矩阵 3 OS × 4 Node = **12 个 job 全部从零 `npm ci` + 重建 core**（`:57-120`）；② 全文件无 `concurrency` 取消；③ Node 18 在矩阵里但 packages/cli 无 `engines` 声明、依赖 React 19/Ink 6；④ e2e 在 Windows 跳过（`:115-117`，stdout flush 问题——应该修而不是永久跳过） |
| `cli-release.yml`                                                                           | 手动触发、四平台组装 tarball 上传 GitHub Release（当前真实发布路径，最新两条 commit 都在修它） | 与 `stable-release.yml` 职责重叠（见下）                                                                                                                                                                                                                                    |
| `docs-gh-pages.yml`                                                                         | push docs/** → 构建部署 Pages                                                                  | 正常，保留                                                                                                                                                                                                                                                                  |
| `pr-checks.yaml`                                                                            | PR/push：prettier + core/binary/gui/vscode/packages 检查                                       | `gui-checks`、`vscode-checks` 属 IDE（应关）；prettier-check 与各包自身检查重复；**无 paths 过滤**，改 docs 也会跑全量                                                                                                                                                      |
| `reusable-release.yml` + 4 个 `release-*.yml`（config-yaml/fetch/llm-info/openai-adapters） | npm 包 semantic-release                                                                        | **CLI 已改为 `file:` 本地依赖**（`packages/cli/package.json`：`@tnt/sdk`、`@tnt/config-yaml` 等全部 `file:../../...`），这 4 个 npm 发布链与 CLI 实际消费方式脱节——要么明确定位"给外部消费者"，要么停用                                                                     |
| `stable-release.yml`                                                                        | 手动输版本 → npm OIDC publish + tag + Release                                                  | **`:92-134` 还有"Publish Blueprints to Runloop"段落**（Continue 云沙箱遗留，TNT 无此服务，RUNLOOP_API_KEY 大概率已失效），必须删                                                                                                                                            |

**B. 暂时关闭（IDE 相关，保留文件待重构后重开，提交时注明）**

| Workflow                                             | 触发                                                                                           | 关闭方式建议                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `jetbrains-release.yaml`（20KB）                     | release prereleased（v1.0.*-jetbrains）+ 手动                                                  | 文件顶部加 `if: false && …` 或注释掉 `on:`，保留历史便于重开 |
| `main.yaml`                                          | release released → 8 平台 VSIX 构建 + marketplace/OpenVSX 发布（`:23` 只匹配 `v1.2.*-vscode`） | 同上                                                         |
| `preview.yaml`                                       | release prereleased（v1.3.*-vscode）                                                           | 同上                                                         |
| `vscode-prerelease.yml` / `vscode-version-bump.yml`  | 手动                                                                                           | 同上                                                         |
| `pr-build-upload-vsix.yaml`                          | 每个 PR 构建 VSIX                                                                              | 同上（这个每个 PR 都在白白构建）                             |
| `main-build.yaml`                                    | push main → 重发 PR 的 VSIX 工件                                                               | 同上                                                         |
| `auto-release.yml`                                   | push 特定分支 → 创建 vscode/jetbrains draft release                                            | 同上                                                         |
| `pr-checks.yaml` 的 `gui-checks`/`vscode-checks` job | —                                                                                              | 加 `if: false` 或 paths 过滤，core/binary 保留（CLI 依赖）   |

统一提交说明模板：`chore(ci): suspend IDE extension pipelines (vscode/jetbrains/gui) — kept for future rework, re-enable after the IDE refactor`。

**C. 删除或改造（Continue 遗留设施，对 TNT 无效或依赖已失效的外部服务）**

| Workflow                                                                                                                                            | 遗留证据                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `upload-runloop-blueprint.yml` + `runloop-blueprint*.json` ×2                                                                                       | Runloop 云沙箱（TNT 无此服务）                                                                                                       |
| `snyk-agent.yaml`                                                                                                                                   | `:24-26` 安装 `@tnt/cli` 后跑 **`cn` 二进制**（旧名！）+ `tnt/snyk-code-scan-agent`（Continue 云 agent），无 CONTINUE_API_KEY 必失败 |
| `tidy-up-codebase.yml`                                                                                                                              | 经 `run-continue-agent.yml` 用 CONTINUE_API_KEY 跑云 agent                                                                           |
| `continue-agents.yml` / `run-continue-agent.yml`                                                                                                    | Continue 内部 agent runner                                                                                                           |
| `auto-fix-failed-tests.yml`                                                                                                                         | 已被 `if: false` 禁用（`:25`），留着只剩噪音                                                                                         |
| `metrics.yaml` / `similar-issues.yml`                                                                                                               | Continue 的 issue 运营指标 / AI 相似问题检测                                                                                         |
| `cla.yaml`                                                                                                                                          | CLA 助手，fork 视需要决定                                                                                                            |
| `label-merged-prs.yml` / `auto-assign-issue.yaml` / `stale-issue-helper.yaml` / `delete-stale-branches.yaml` / `submit-github-dependency-graph.yml` | 社区管理类，无害，可保留或随运营策略调整                                                                                             |

### 3.2 CI 效率优化清单（A 类顺手做）

1. 三个 PR 类 workflow 都加 `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`。
2. `cli-pr-checks` 的 core 构建结果用 `actions/cache` 按 `hashFiles('core/**')` 缓存（12 个矩阵 job 重复构建 core 是最大浪费）。
3. 测试矩阵收敛为主力组合（ubuntu × node 20/22）必跑，Windows/macOS + node 18/24 降为 nightly 或仅 release 前跑——当前 12 格矩阵对一个 fork 的 PR 门禁太重。
4. `pr-checks.yaml` 与 `cli-pr-checks.yml` 对同一 PR 的 prettier/lint 有重叠，明确分工（一个管仓库级、一个管包级）或合并。
5. Windows e2e 的 stdout flush 问题排期修复（`cli-pr-checks.yml:115-117` 的注释已定位方向）。

---

## 4. 文档专项（docs/ + docs-site/）

### 4.1 结构现状

- `docs/cli/` 19 页 + `docs/zh/cli/` 19 页**完全对齐**（diff 验证），内容与实现一致性高——这部分质量是好的。
- `docs-site/` 是 Next.js 静态导出，按 slug 直读 `../docs/*.mdx`（`docs-site/lib/docs.ts:6`），搜索索引只收 nav 内页面。
- `docs.json` / `docs.zh.json` 导航**无坏链**；文档债集中在**13 个未进 nav 的孤立英文页**（约 1200 行 Continue 时代内容）：`home.mdx`、`overview.mdx`、`faqs.mdx`、`reference.mdx`、`troubleshooting.mdx`、`autocomplete/`、`chat/`、`reference/` 下 6 页。

### 4.2 P0（面向用户且错误，会照着做错）

1. `docs/home.mdx` 整页是 Continue 旧首页，`:15-18` 四个链接全 404（redirects 只做精确匹配，`docs-site/lib/docs.ts:52-66`），`:20` 指向 docs.continue.dev——**删除或重写**。
2. `docs/overview.mdx:16-17` 安装命令是 `npm i -g @continuedev/cli`（错误包名，TNT 是 `@tnt/cli`）；`:34` 指向不存在的 `/cli/tui-mode`（实际是 `/cli/tui`）——**删除或重写**。
3. `docs/cli/configuration.mdx:118`（中文 `docs/zh/cli/configuration.mdx:112` 同）："`tnt init` creates an AGENTS.md"——**`tnt init` 子命令不存在**，实际是会话内 `/init` 斜杠命令（`src/ui/commands/builtins.ts:34`）。
4. `docs/cli/headless-mode.mdx:49`：把 `tnt checks` 描述成"run the repository check pipeline"——实现是**查看 PR 的 CI 检查状态（list/accept/reject）**（`src/index.ts:447-448`）。
5. 根 `README.md:33`：VS Code Marketplace / OpenVSX 徽章指向 `Continue.continue`——装的是 Continue 不是 TNT；且 `:19` 宣传三形态但未说明 IDE 插件暂停维护（与 `packages/cli/ARCHITECTURE-tnt.md:3` 矛盾）。
6. `docs/cli/hooks.mdx:45`（中文同）：示例用 `$TNT_FILE_PATH`——源码 hooks 里**没有这个插值**，疑似虚构，需核实修正。

### 4.3 P1（过时但不算错）

7. headless flags 表缺 `--output-schema`、`--request-timeout`、`--fork`（`src/index.ts:227-240` 已实现）。
8. `tnt review`（`--uncommitted/--commit/--range/--review-agents/--review-model`，`src/index.ts:477-498`）与 `tnt serve`（`--host 0.0.0.0` 需安全警告）无专页。
9. 环境变量补齐：`TNT_HEADLESS_TIMEOUT`、`TNT_GLOBAL_DIR`（`configuration.mdx:101` 只模糊说"global directory env var"没写名字）、`TNT_API_BASE`、`TNT_PLUGINS_DIR`、`TNT_THEME`。
10. `faqs.mdx:295` 还在教用户敲旧二进制名 `cn`；faqs/troubleshooting 全文 `~/.continue` 路径（各 20+ 处）。
11. 13 个孤立页处理：IDE 时代页（autocomplete/、chat/、reference/deprecated-*）删除，faqs/reference 有价值的 TNT 化后纳入 nav。
12. `TESTING.md` 是某个 PR 的勾选清单（非现行测试文档），标注归档或删除；`packages/cli/AGENTS.md` 中 "readline-based" 描述与现状（Ink TUI）不符。
13. `CONTRIBUTING.md` 标题/锚点/命令改 TNT（`:1,5,8,18,32-34`），`:205` 起 IDE 章节标注冻结。

### 4.4 P2（一致性）

14. `packages/cli/README.md:5` 链接文字 "Continue" 实际指向 TNT repo；15. `docs/README.md` 还是 Mintlify starter 模板文案；16. `configuration.mdx:58-62` 补根目录 `.mcp.json` 兼容加载（`mcpConfig.ts:20`）；17. 清理 `docs/` 的第三方追踪脚本（`reo-tracking.js`、`c15t-cookie-banner.js`）与 `images/images/` 双层嵌套；18. 中文 quickstart 未复用 `snippets/cli-install.mdx`（双维护点）。

---

## 5. 安全专项（mimosa deep + 人工抽查复核）

### 5.1 数据与分布

534 条静态发现（high 350 / medium 183 / low 1），按目录分布：

| 区域                          | 数量 | 占比    | 说明                                 |
| ----------------------------- | ---- | ------- | ------------------------------------ |
| `ide/vscode` + `ide/intellij` | 386  | **72%** | 冻结区，IDE 重构时再处理，现在不投入 |
| `packages/cli`                | 58   | 11%     | 产品主体，抽查见下                   |
| `core/*`                      | 77   | 14%     | CLI 依赖的引擎，重点看 config/util   |
| 其他                          | 13   | 3%      | docs-site 4 条（追踪脚本相关）等     |

### 5.2 误报率说明

- "硬编码凭据" 68 条中 66 条是占位常量/测试 fixture（如 `core/llm/constants.ts:19` 的 `MISSING_API_KEY`），**基本全是误报**。
- "命令注入/SSRF/路径穿越"类多为 `execSync` 模板串模式的启发式告警，需逐条人工复核，但不是空穴来风（见 5.3 抽查）。

### 5.3 抽查后值得处理的（按优先级）

1. **`tnt serve` 的 `/permission` 端点无鉴权**（`packages/cli/src/commands/serve.ts:313-330`）：默认绑 `127.0.0.1`（`:456`，安全默认）但端点只校验 requestId，**无 token / 无 Origin 校验**。本机浏览器里的恶意页面可向 `http://127.0.0.1:<port>/permission` 发 POST 批准工具权限（经典本地 CSRF/DNS-rebinding 面）。修复建议：serve 启动时生成一次性 token 打进日志/输出，请求头校验；或校验 Origin/Host 为空或 localhost。
2. **`utils/git.ts:14` `execSync(\`git remote get-url ${remote}\`)`** 模板串拼参——改参数数组形式（`execFileSync`）。
3. **session 路径穿越族（10+ 条）**：`getTranscriptPath`、`ensureSessionScopedDir`、`getLegacySessionPath` 等会话 ID 参与路径拼接，建议统一加 ID 白名单校验（`[a-zA-Z0-9-_]`）后收一组告警。
4. **`core/config/load.ts:691,737`** 命令注入告警——config 是用户自己写的文件，风险等级取决于是否加载项目级 config（若项目级可注入命令则等效提示注入 RCE），建议人工复核后定级。
5. `useConfigSelector.ts:53` 命令注入告警——同上人工复核。

### 5.4 顺带发现

`docs-site` 的 4 条发现与 `reo-tracking.js`/`c15t-cookie-banner.js` 第三方追踪脚本有关（§4.4-17 已列清理项）， forks 不该背着原厂的统计脚本。

---

## 6. 其他质量问题

1. **仓库卫生**：`packages/cli/tnt-cli-v1.0.*.tar.gz` ×7 约 350MB 已入库，建议移出 git（gitignore + Release 附件承载），做一次历史瘦身可选（rewrite history 有破坏性，需单独决策）。
2. **ESLint 10 个 import/order + Prettier 7 个文件**：`--fix` 一把全修，作为卫生批 commit。
3. **Node 版本声明缺失**：packages/cli 无 `engines` 字段，但 CI 矩阵从 18 跑到 24，依赖 React 19/Ink 6——建议定死 `>=20` 并同步矩阵。
4. **`upstream` 未 fetch**：建议 fetch 一次并打个基线 tag，方便后续对比上游安全修复 cherry-pick。
5. **参考文档过时**：`test-continue/REFERENCE_REVIEW_TNT.md:242` 描述的 `StaticChatContent.tsx` 在当前代码不存在——你依赖这份综述做决策时注意其"现状"章节落后于代码（规划方向仍有效）。

---

## 7. 建议执行顺序（每步独立 commit，等你拍板）

| 批次                | 内容                                                                                                                                               | 规模     | 风险                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| **P0-1 卫生批**     | 注释清洗（§2.4：pi 7 处 + Claude Code 注释改中性）+ eslint --fix + prettier --write + Node engines 字段                                            | 半小时级 | 零（纯文案/格式，CI 全绿验证）                       |
| **P0-2 CI 收编**    | 关 8 个 IDE workflow + `pr-checks.yaml` 的 gui/vscode job（保留文件、加说明）+ 删 Runloop 段落与遗留 workflow ×10 + 加 concurrency + core 构建缓存 | 半天     | 低（改动全在 .github/）                              |
| **P0-3 文档 P0**    | §4.2 的 6 条错误修正                                                                                                                               | 半天     | 零                                                   |
| **P1-1 TUI 方案 A** | 帧合并 + batched scroll + 行窗虚拟化 + 滚动条列（`/sessions` 两面板同时受益）+ resetTranscript 收编                                                | 3-5 天   | 中（有 3369 测试与 useFlickerDetector 移植兜底验证） |
| **P1-2 serve 鉴权** | §5.3-1                                                                                                                                             | 半天     | 低                                                   |
| **P2**              | 文档 P1/P2、CI 矩阵收敛、Windows e2e 修复、session 路径校验、tar.gz 清理、方案 B 评估                                                              | 按周排   | —                                                    |

---

_报告完。所有 `文件:行号` 均已在本机验证；安全扫描原始证据见 §1 所列目录（seal 可复核）。_
