# 交接文档：TNT 产品能力差距分析（2026-10-25，详细版）

**本文用途**：把本轮"对标一线编码代理"的分析工作完整交接给下一个代理。读完本文 + 工作区根目录的 `PRODUCT-GAP-ANALYSIS-2026-10-24.md`，即可无缝接手，不需要回看对话历史。

---

## 0. 60 秒速览

- **做了什么**：对 TNT CLI 做了一轮"产品能力"差距分析（不是代码质量审计），对照参考库和本机安装的闭源产品，产出带证据的差距清单与 P0-P2 路线图。
- **结论在哪**：`/home/lin/All_projects/GithubProjects/continue/PRODUCT-GAP-ANALYSIS-2026-10-24.md`（修订版 v2，约 19KB，**未提交**）。
- **核心结论**：工程底座已达标（431 测试文件，427 通过 / 4 跳过 / 0 失败，tsc 0 错）；剩余四个高影响差距：①权限模型缺危险 allow 前缀剥离；②Search 工具默认 allow 且未接执行期策略；③TUI 流式渲染无 Static 分区（半成品 `transcriptSegments.ts` 已在）；④工具可见面无"完全划分"守卫。
- **工作流状态**：七路并行分析工作流**失败**（provider 配额耗尽 + 重放不确定性），**没有产出任何子代理结论**；报告内容全部来自撰写会话的本地核验。这是本轮最大的覆盖缺口，见 §6。
- **下一步**：按报告 §5 的 P0 四项（约 2 天）开始落地；若要补齐五个未独立分析的维度，用有配额的 provider 重跑工作流或改用普通子代理，见 §5.3。

---

## 1. 任务背景与目标

用户的目标（原话大意）：全面分析 TNT 代码，找出还能提高的地方；最终目的是达到 Cursor / Claude Code / Codex 那样工程化的产品——能深度理解代码库、开发高质量代码、像 Cursor 那样做软件工程优化。

可用的素材：

- TNT 本体：`/home/lin/All_projects/GithubProjects/continue`（Continue 的分支，产品名 TNT，CLI 在 `packages/cli`）。
- 参考源码库：`/home/lin/All_projects/GithubProjects/test-continue`，含多套一线代理的完整源码/分发码：`pi/`、`omp/`、`opencode/`、`gemini-cli/`、`codex/`、`claude-code/`、`Open-ClaudeCode/`、`baocode/`、`peri/`、`reasonix/`、`dsh/`，以及按厂商分目录的泄露提示词语料 `system_prompts_leaks/`。
- 参考库里已有的、针对 TNT 的研究文档（重要，避免重复劳动）：
  - `REFERENCE_REVIEW_TNT.md`（79.5K，2026-10-15，逐条带双方证据，基线 TNT HEAD=2b21f6eaa）
  - `NEXT_GOAL_TNT.md`（26K，长期 goal 文件）
  - `SYSTEM_PROMPT_CANON.md`（9.2K，蒸馏后的系统提示词条款，逐行标注是否已在 TNT 落地）
  - `CURSOR_AGENT.md`（8.9K）、`COMPOSER_REFERENCE.md`（10.8K，已解码的逆向笔记）、`ARCHITECTURE.md`、`STRUCTURE_PLAN.md`
- 本机安装的闭源/官方产品：
  - 官方 claude code：npm 全局 `@anthropic-ai/claude-code`（原生二进制在其 `node_modules/@anthropic-ai/claude-code-linux-x64/claude`）
  - cursor-agent CLI：`~/.local/bin/cursor-agent`
  - Cursor IDE：deb 包 3.26.13，装在 `/usr/share/cursor`（`resources/app/` 下有 `product.json`、`out/`、`extensions/` 全套 cursor-* agent 与检索扩展、`node_modules.asar`）
  - commandcode：npm 全局 `command-code`，另有 `/opt/Command Code`
  - REA 已安装，可做二进制级深度逆向（本轮未使用，见 §6）

---

## 2. 项目速览（接手前必读）

### 2.1 架构基调

- **one engine four surfaces**：一个引擎驱动 TUI / headless / serve / ACP 四个面。
- 模块化 + eslint 严格限额：`max-lines 500`、`max-statements 50`、`complexity 30`、`max-params 5`、`no-negated-condition`。风格是"拆函数/拆 hook"，不是加豁免。
- `spec/` 目录有双向守护测试（`tuiDoc.test.ts`、`serveSurface.test.ts` 同时读 spec 和组件源码，断言两边一致）。改了行为要同步改 spec，否则测试红。
- 测试用 vitest；`packages/cli` 是主战场，`core/` 是 Continue 共享 SDK。

### 2.2 `packages/cli/src` 模块地图（差距分析会反复引用）

```
acp/ agent/ auth/ cache/ commands/ compaction/ config/ hooks/ i18n/
loop/ lsp/ mcp/ permissions/ platform/ plugins/ protocol/ retrieval/
services/ session/ startup/ stream/ subagent/ telemetry/ tools/ ui/ utils/
```

关键点：**这些模块大多已经存在且带测试**（agent/systemMessage、loop/contextBudget、loop/loopDetector、compaction/microCompact、permissions/sessionApprovals、subagent/builtInAgents、tools/applyPatch、retrieval/、lsp/）。任何"TNT 没有 X"的判断都必须先读代码验证——这是本轮最重要的方法学教训（见 §5.4）。

### 2.3 命令与基线

- 测试：`cd packages/cli && npx vitest run`
- 类型：`npx tsc --noEmit`
- Lint：`npx eslint`
- 报告作者实测基线（2026-10-25，含当时未提交改动）：431 个测试文件，427 通过 / 4 跳过 / 0 失败；3436 用例 3431 通过 / 5 跳过 / 0 失败。`packages/openai-adapters` 的 usage 归一 14 用例通过。
- 当前 HEAD：`360cfaede`（feat(tui): fold big pastes behind a line count and search history with ctrl+f）。
- 工作区里有**另一个代理的在途未提交改动**（`TUIChat.tsx`、`ScreenContent.tsx`、`Composer.tsx`、`builtins.ts`、`handlers/index.ts`、`types.ts`、`docs/cli/configuration.mdx`、`docs/zh/cli/configuration.mdx`、`i18n/index.ts` 等）。动这些文件前先 `git status`，按文件所有权错峰，不要顺手提交别人的改动。

---

## 3. 已完成的工作（时间线）

1. **勘察**：确认 TNT 模块成熟度、参考库内容、本机闭源产品位置。
2. **设计并启动七路分析工作流**（1 条既有研究对账 + 6 个能力维度，每条链内"分析员 → 独立复核员"；汇总 → 独立审读 → 修订 → 发布产物）。
3. **修订**：用户指出 Cursor 有两个发行物（CLI 与 IDE），把"闭源发行物对照"维度扩为同时覆盖 `cursor-agent` 与 `/usr/share/cursor/resources/app/`；其余六条链提示词字节不变以命中缓存。
4. **中断 1**：provider `bigmodel-start-plan` / GLM-5.3 配额耗尽（code 1005 "exceed quota limit"），全部链失败。已完成的步骤记在 journal。
5. **恢复**：`ResumeWorkflowRun` 续跑；随后被用户停止，最终以 `errored` 终止——重放时 `report#9` 的 inputHash 不一致（脚本在并发链里调用 `report()`，落盘顺序随完成时序变化，journal 无法确定性重放）。
6. **兜底**：汇总代理在链失败后改用本地核验写完了报告（v2），并明确声明"不采用任何失败链的结论"。之后又经一次独立审读修订（撤下两条被证伪的差距）。
7. **交接**：产出本文。

---

## 4. 结论本体（详细）

报告文件：`PRODUCT-GAP-ANALYSIS-2026-10-24.md`（仓库根，untracked，未提交）。结构：执行摘要 / 既有研究对账 / 确认差距清单 / 待人工复核 / 行动路线图 / 风险与依赖。以下是要点摘录，动手前仍建议读原文（原文带完整 file:line）。

### 4.1 既有研究对账（防止重复劳动）

对 `REFERENCE_REVIEW_TNT.md` 等的抽查结果（当前树 HEAD=360cfaede）：**26 done / 4 partial / 7 not-done / 2 stale**。

已收口、**不要再做**的典型项：

- Search 已改 `execFile` + args 数组（注入面已消）
- MCP 工具命名空间 `mcp__<server>__<tool>`（有冲突测试）
- 工作区写边界（`isWithinWorkspace`）
- 会话级审批缓存 `permissions/sessionApprovals.ts`（MCP 永不缓存、命令规范化键、容量淘汰、三处接线齐全）
- 时间驱动微压缩 `compaction/microCompact.ts`（`DEFAULT_CACHE_GAP_MS = 5 分钟`，`shouldMicroCompact` 纯函数，接线在 `streamChatResponse.ts`）
- Anthropic 断点收敛 ≤2、normalizeUsage 三适配器归一、hook `transcript_path` 实填、大型粘贴折叠 + Ctrl+F 历史搜索等（见报告 §2.2 全表）

**两条被证伪的"差距"（重要，别重新提）**：

- 原 G-5「会话级审批缓存缺失」→ 实际是 `sessionApprovals.ts`，机制名不同导致 grep 假阴性。
- 原 G-6「时间驱动微压缩缺失」→ 实际是 `microCompact.ts` 的 `gapMs`，同上。

### 4.2 四个高影响差距（P0，约 2 天）

**G-1 权限模型缺危险 allow 前缀剥离**

- 现状：`permissions/permissionChecker.ts:188-197` 规则命中即 `break` 返回 `basePermission`；命中后的窄化只有 `docsOnly / workspaceOnly / readOnlyAllow / readOnlyOnly` 四种，没有"allow 命中的命令含危险前缀/算子则降级 ask"的路径；`permissions/` 下无危险前缀表。
- 参考机制：claude-code `dangerousPatterns.ts:18-79` 按类别列解释器/包运行器/shell 算子/ssh/sudo，高风险模式时剥离 allow（行号为转述）。
- 落地：**改造**。在规则命中点后插一层降级；词表按 TNT 自身工具面自列，不抄词表。
- **边界澄清**：`permissions/policyWriter.ts:29-37` 不是缺口——它写盘的 `Bash(cmd*)` 只对非危险首词生效，危险单命令写全串，分层是正确的。缺的是**匹配侧**剥离，不是写盘侧形状。

**G-2 Search 工具未接执行期策略钩子且默认 allow**

- 现状：`permissions/defaultPolicies.ts:29,89` 均 `allow`；`tools/searchCode.ts` 没有 `evaluateToolCallPolicy`（只有 `runTerminalCommand.ts:189` 有）。
- 落地：**改造**。改为 `ask + readOnlyAllow`（TNT 已有 readOnlyAllow 机制，auto 模式下按现有语义放行只读），并给 searchCode 接策略钩子。半天量级。

**G-3 TUI 流式渲染无 Static 分区（半成品已在）**

- 现状：全树无 JSX `<Static>`（grep 只命中 `transcriptSegments.ts:5` 的注释）；但 `ui/utils/transcriptSegments.ts:16-27` 已有 settled/live 按条切分的纯函数 + 测试，`TUIChat.tsx:212,311` 有 `setStaticRefreshTrigger` / `onRefreshStatic` 铺垫。
- 缺三件事：①切分函数未接渲染层；②无 pending buffer（chunk 直进历史）；③无内容级安全切点（流式文本切分不落未闭合代码围栏）。
- 落地：**改造**，分两步（P1-2 接线 / P1-3 pending buffer + 安全切点），2-3 天。不引入 ink fork。

**G-4 工具可见面无"完全划分"守卫**

- 现状：`tools/registry.ts:99+` push 组装；`documentedSurface.test.ts:39` 只断言单点（Rename 未暴露），没有全集等式。
- 落地：**自研**一条测试：`ALL_BUILT_IN_TOOLS 名集 = registry 可见集 ∪ 显式 UNEXPOSED_REASONS 键集`，不等即红。半天。

### 4.3 中低影响与路线图

- **P0**（上表四项）。
- **P1**：缓存守卫进 e2e（mock 回吐 hit/miss、尾部 3 轮均值先 80% 起步）；TUI 流式接线两步。
- **P2**：全屏 Static 定稿评估、两轴终止 + 抢占 token、systemMessage 分节 merge-patch、上下文预算注入、changed_files 模型可见重注入、录制回放测试层 + Windows headless e2e。
- 依赖关系：P0-1 与 P0-2 同碰权限文件要串行；P1-2 → P1-3 有序；P2-2 与 P1-2/P1-3 同碰 stream 回调要错峰；P2-3 → P2-4 → P2-5 是同一条上下文线。

### 4.4 可信度边界（务必向用户转达）

1. TNT 侧所有 file:line 都是报告作者亲自读源码/grep 验证的。
2. **参考库侧行号是转述自 `REFERENCE_REVIEW_TNT.md`，未逐一复核**——移植前必须回参考源码重新定位，行号可能已漂移。
3. 报告不含任何工作流子代理的结论（链全失败）。
4. "未发现"型结论存在残余假阴性风险；报告已对关键条目做机制形状二次核验，但批次 P（缓存守卫 e2e）与批次 11（两轴终止）建议动手前做文件级确认。
5. 缓存断点数 2 是否最优未经真实密钥验证（报告 §4-2）。

---

## 5. 工作流本身（复跑必读）

### 5.1 设计

- 7 条并行链：1 条"既有研究对账" + 6 个能力维度（检索与代码库理解 / Agent 执行引擎 / 上下文工程 / 工具与能力面 / 安全与权限 / 闭源发行物对照）。
- 链内串行：分析员（产出 typed `AnalysisResult`，≤6 条差距，每条要求双方 path:line）→ 独立复核员（重新打开证据文件核对，回填 confirmed/reviewNote）。
- 终段：首席汇总（写报告文件）→ 独立审读员（挑误导/缺失/无证据）→ 汇总代理修订 → 发布 artifact。
- 看板 artifact（`progress` board）按维度展示 分析中/复核中/已完成/失败。

### 5.2 两次中断的准确原因

1. **配额**：`provider=account:bigmodel-start-plan model=GLM-5.3 code=1005 exceed quota limit`。所有在飞请求失败，各链进入 catch 分支标记"失败"。
2. **不可重放**：恢复后 journal 重放报 `Replay hit at report#9@1 but inputHash differs (expected 9365297c, got b85ec977): the script is not deterministic`。根因：`report()` 在 7 条并发链里随完成时序调用，每次运行的落盘顺序不同；`ResumeWorkflowRun` 因此拒绝。**教训：要可续跑，report 调用必须确定性有序**（例如只在 join 之后按固定维度顺序 report，或用固定 id 的 item）。

### 5.3 复跑指引

- 草稿脚本在 `packages/cli/src/.zcode/workflow-drafts/`（注意：因为提交时 shell cwd 在 `packages/cli/src`，工作流把 `.zcode/` 建在了那里）：
  - `七路并行既有研究对账--六个能力维度对比逐条独立复核.dwf.ts`（最新修订版，含 Cursor IDE 两个发行物的完整任务书）
  - `TNT-产品能力差距分析.dwf.ts` / `-2.dwf.ts`（早期版本，可忽略）
- 复跑前提：**确认 provider 有配额**（用户决定是否充值/升级/换 provider）。subagent 模型不要自行跨 provider 迁移。
- 若要改脚本，先改两处再提交：
  1. 把 fan-out 内的 `report(...)` 移到 join 之后按固定顺序执行，或直接删掉逐条 report（报告内容不依赖它们）——这是可续跑的关键；
  2. 若希望减少配额消耗，可把 6 个维度拆成两批跑，或复用已有报告的结论只补"闭源发行物对照"与"检索/引擎/上下文/工具"四个维度。
- 也可不用工作流：用普通子代理按同一任务书逐维度跑，更适合配额紧张的场景。

### 5.4 方法学教训（写进肌肉记忆）

1. **"grep 不到" ≠ "没有"**。参考库文件名/关键词在 TNT 里为空，可能只是命名不同。任何"未发现"型结论必须换机制形状关键词二次核验，最好读文件级确认。已兑现两例：`sessionApprovals`（不是 approvalCache）、`gapMs`（不是 gapThreshold/timeBased）。
2. **参考库行号会漂移**，尤其旧研究文档写于 2026-10-15、基线是 `2b21f6eaa`。
3. **配额是硬约束**：多链并发 × 长分析会快速烧额度，先估算再启动。
4. **产物只认落盘**：汇总阶段写文件 + `artifact.file` 发布，确保即使后续失败用户也能拿到东西。

---

## 6. 覆盖缺口与补齐方式

| 缺口                                                       | 现状                                             | 补齐方式                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 检索与代码库理解、Agent 执行引擎、上下文工程、工具与能力面 | 无独立新分析；由旧文档对账与两份既有报告间接覆盖 | 用有配额 provider 重跑对应维度链，或普通子代理逐维度分析                                                                                                                                                                              |
| **闭源发行物对照**                                         | **完全无覆盖**（链失败前只在分析阶段）           | 优先补：Cursor IDE `/usr/share/cursor/resources/app/`（extensions/ 的 cursor-agent-host/worker/exec、local-agent-runtime、检索扩展、product.json）、cursor-agent CLI、官方 claude code 分发物、commandcode；可配合 REA 做二进制级提取 |
| 真实效果/成本基准（跑分对比）                              | 未做                                             | 需要真实任务集与预算，超出本轮范围                                                                                                                                                                                                    |
| 缓存断点真实命中率                                         | 无密钥未跑                                       | 带密钥跑 `anthropic-caching.live.test.ts`，记录连续两轮 cacheRead                                                                                                                                                                     |
| REA 深度逆向                                               | 未使用                                           | 对具体差距逐项深挖时再用；不要一次性倒出大图                                                                                                                                                                                          |

---

## 7. 硬性约束（用户已定，违反即返工）

1. **代码注释、说明文字、文件名不得出现任何参考产品名**（cursor、pi、gemini、claude、codex、omp、opencode、claude-code 等）。功能兼容路径（如 `hookConfig.ts` 的 `~/.claude/settings.json`）保留，注释写中性表述。
2. **阈值按 TNT 自身重标定**，先保守后收紧，定标过程写进提交信息。反例警戒：TNT 的缓存 gap 是 5 分钟，参考库是 60 分钟——不要"改回参考值"。
3. **提交规范**：conventional commits；每步独立 commit；提交前 `npx vitest run` + `npx tsc --noEmit` + `npx eslint` 全绿；用户可见文案同时加 en 与 zh（`src/i18n/index.ts`）。
4. **文件所有权**：仓库有另一代理在做在途改动（TUI 配置相关），动共享文件前看 `git status`，错峰，不提交别人的改动。
5. **工具约束**：Bash 直接写源码/配置会被 Mimosa hook 拦，源码改动用 Write/Edit；提交用用户手动或 MCP git 工具（用户曾授权）；不要执行任何闭源产品二进制，只读分发文件。

---

## 8. 关键事实速查

```
TNT 仓库         /home/lin/All_projects/GithubProjects/continue
HEAD             360cfaede
CLI 源码         packages/cli/src（模块见 §2.2）
主报告           PRODUCT-GAP-ANALYSIS-2026-10-24.md（untracked）
上一轮治理       QUALITY-AUDIT-REPORT-2026-10-24.md
TUI 专项         TUI-GAP-ANALYSIS-2026-10-25.md
参考源码库       /home/lin/All_projects/GithubProjects/test-continue
旧研究文档       test-continue/REFERENCE_REVIEW_TNT.md 等（基线 2b21f6eaa）
工作流草稿       packages/cli/src/.zcode/workflow-drafts/*.dwf.ts
测试基线         431 文件 / 427 通过 / 4 跳过 / 0 失败（报告作者实测）
闭源产品         claude code（npm 全局）、cursor-agent（~/.local/bin）、
                 Cursor IDE（/usr/share/cursor，deb 3.26.13）、commandcode（npm 全局）
```

---

## 9. 建议的接手步骤（含验收）

1. 读 §4 与报告原文，确认四条 P0 的现状证据仍然成立（行号可能因在途改动漂移）。
2. 跑一次门禁建立自己的基线：`cd packages/cli && npx vitest run && npx tsc --noEmit && npx eslint`。
3. 按 P0-1 → P0-2（串行，同碰权限文件）→ P0-3 → P0-4 落地，每项独立 commit + 测试。
4. 每个 P0 的验收：
   - P0-1：新增降级分支有单测（危险前缀/算子命中 allow 规则 → ask）；非危险命令行为不变；policyWriter 不改语义。
   - P0-2：Search 默认策略变更后，只读 auto 模式行为不变、交互式被 ask；`searchCode` 接策略钩子的路径有测试。
   - P0-3：`writeFile.test.ts` 五类拒绝用例（含 `.tnt/settings.json`、`.env`、越界、`../escape`、symlink 外逃）；read/edit 行为不回归。
   - P0-4：完全划分守卫红测试；故意从 UNEXPOSED_REASONS 删一项即变红。
5. 若要补维度：先确认 provider 配额，再按 §5.3 复跑（记得先修 report 确定性）。补出的结论与本报告冲突时，**以带本机可复现证据者为准**。
6. 所有新增/修改的用户可见文案补 en + zh；涉及 spec 描述的行为变化同步改 `spec/`（双向守护测试会拦）。

---

## 10. 交付物清单（哪些文件必须一起交接）

**重要：根目录的几份分析文档全部是 untracked（未提交），工作流草稿所在目录更是 git-ignored。只复制交接文档本身不带证据文件的话，接手代理会失去完整证据链。** 在同一个工作区/同一台机器上接手时，按绝对路径读取即可；如果要在别的工作副本里接手，先把下表的"必须带走"文件复制过去：

| 文件（绝对路径）                                                                    | 内容                                         | git 状态  | 是否必须带走               |
| ----------------------------------------------------------------------------------- | -------------------------------------------- | --------- | -------------------------- |
| `/home/lin/All_projects/GithubProjects/continue/HANDOFF-PRODUCT-GAP-ANALYSIS.md`    | 本文（交接说明 + 工作流全文）                | untracked | 是                         |
| `/home/lin/All_projects/GithubProjects/continue/PRODUCT-GAP-ANALYSIS-2026-10-24.md` | **结论本体**：26.8K，全部证据 + P0-P2 路线图 | untracked | 是                         |
| `/home/lin/All_projects/GithubProjects/continue/QUALITY-AUDIT-REPORT-2026-10-24.md` | 上一轮质量治理审计（背景）                   | untracked | 建议                       |
| `/home/lin/All_projects/GithubProjects/continue/TUI-GAP-ANALYSIS-2026-10-25.md`     | TUI 专项差距（与本轮互补）                   | untracked | 建议                       |
| `/home/lin/All_projects/GithubProjects/test-continue/`                              | 参考源码库 + 旧研究文档 + 泄露提示词语料     | 独立仓库  | 视任务（跑参考对照时需要） |
| `packages/cli/src/.zcode/workflow-drafts/*.dwf.ts`                                  | 工作流脚本（**git-ignored，不会随仓库走**）  | ignored   | 否——全文已内嵌在附录 A     |

复制命令（目标工作区按需替换）：

```bash
cp HANDOFF-PRODUCT-GAP-ANALYSIS.md PRODUCT-GAP-ANALYSIS-2026-10-24.md \
   QUALITY-AUDIT-REPORT-2026-10-24.md TUI-GAP-ANALYSIS-2026-10-25.md \
   /目标工作区/
```

### 10.1 工作流运行记录

| run ID                                        | 状态                              | 原因                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dwfrun-276867df-b08e-45a8-95e9-4a868433602a` | stopped（被取代）                 | 首次启动；因用户指出 Cursor 有两个发行物而修订                                                                                                                         |
| `dwfrun-15d44609-5aa7-447f-a5fa-92d54dffdb53` | errored                           | ① provider `bigmodel-start-plan`/GLM-5.3 配额耗尽（code 1005），全部链失败；② 恢复后重放报 `report#9` inputHash 不一致（并发链里 report 顺序不确定），journal 不可重放 |
| 产物                                          | `progress` board（17 项阶段记录） | 只在宿主 UI，未落盘；失败后无分析结论可继承                                                                                                                            |

**复跑最重要的两点**：①确认 provider 配额；②把 fan-out 内的 `report(...)` 移到 join 之后按固定顺序执行（或删除），否则运行不可续跑。

### 10.2 三份草稿的关系（防止误用旧版）

| 草稿                                                        | 状态                                                                                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TNT-产品能力差距分析.dwf.ts`                               | 最早版。产物 id 是中文（`进度`/`报告`）、最终结果变量名与门面 `report()` 冲突——**有编译错误，勿用**                                                                                |
| `TNT-产品能力差距分析-2.dwf.ts`                             | 可编译可运行版，但"闭源发行物对照"只覆盖 cursor-agent CLI，未含 Cursor IDE                                                                                                         |
| `七路并行既有研究对账--六个能力维度对比逐条独立复核.dwf.ts` | **最新且唯一建议复跑的版本**（= 附录 A 全文）。与 -2 版的差异仅在：闭源维度任务书扩为 Cursor CLI + IDE 双发行物、refs 增加 `/usr/share/cursor/resources/app/`、notCovered 文案同步 |

---

## 附录 A：工作流脚本全文（最新可运行版）

来源：`packages/cli/src/.zcode/workflow-drafts/七路并行既有研究对账--六个能力维度对比逐条独立复核.dwf.ts`（407 行，git-ignored，故全文内嵌于此）。复跑方式：新建/修改该文件后，用 `CreateWorkflow` 的 `path` 提交，或直接在宿主里以该脚本重新发起；**不要**用 `ResumeWorkflowRun` 续跑已 errored 的旧 run。

```ts
interface Dimension {
  /** 维度短名，用于子代理命名与看板卡片 */
  name: string;
  /** 该维度要回答的问题 */
  charter: string;
  /** 重点参考路径（绝对路径） */
  refs: string[];
}

interface GapFinding {
  /** 维度名 */
  dimension: string;
  /** 编号，如 "检索-2" */
  id: string;
  /** 一句话差距：参考产品做了什么而 TNT 没做到或做得弱 */
  gap: string;
  /** TNT 侧证据，path:line（相对仓库根） */
  tntEvidence: string;
  /** 参考侧证据：项目名 + 路径(:行号) */
  referenceEvidence: string;
  /** 建议：直接搬运 / 改造落地 / 需自研，含文件级切入点，2-3 句 */
  recommendation: string;
  /** 对工程化产品目标的影响；high 只给直接拉开产品力差距的缺失 */
  impact: "high" | "medium" | "low";
  /** 复核是否通过（分析员一律填 false） */
  confirmed: boolean;
  /** 复核意见（分析员一律填空串） */
  reviewNote: string;
}

interface AnalysisResult {
  /** TNT 在该维度的现状盘点，3-5 句 */
  inventory: string;
  /** 差距清单，≤6 条，按 impact 降序 */
  findings: GapFinding[];
}

interface DimensionResult {
  dimension: string;
  inventory: string;
  findings: GapFinding[];
  /** 非空表示该链失败，inventory 里带原因 */
  error?: string;
}

interface PriorItem {
  /** 既有文档里的建议标题（简短） */
  item: string;
  /** 来源文档与章节 */
  source: string;
  /** 与当前代码对账后的状态 */
  status: "done" | "partial" | "not-done" | "stale";
  /** TNT 侧证据 path:line（done/partial 必填） */
  evidence: string;
  /** 一句话说明 */
  note: string;
  /** 复核是否通过（分析员填 false） */
  verified: boolean;
  /** 复核意见（分析员填空串） */
  reviewNote: string;
}

interface PriorAudit {
  /** 这批既有研究文档的概况，3-5 句 */
  overview: string;
  /** 影响最大的建议项对账结果，≤15 条 */
  items: PriorItem[];
}

interface Roadmap {
  /** 报告文件的工作区相对路径 */
  reportPath: string;
  /** 最优先的 3 件事，每句一句话 */
  topPriorities: string[];
}

interface Critique {
  /** 会误导维护者的表述 */
  misleading: string[];
  /** 对决策重要但缺失的内容 */
  missing: string[];
  /** 一句总评 */
  verdict: string;
}

interface ReportFinding {
  where: string;
  what: string;
  evidence: string;
  status: "verified" | "unconfirmed";
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  conclusion: string;
  findings: ReportFinding[];
  verified: string[];
  notCovered: string[];
}

const REF_ROOT = "/home/lin/All_projects/GithubProjects/test-continue";
const REPORT_PATH = "PRODUCT-GAP-ANALYSIS-2026-10-24.md";

const COMMON_GUARDS = [
  "硬性要求：",
  "1. TNT 已经实现的（哪怕实现得一般）绝不能当作「没有」上报——先读到代码再下结论；很多模块带同名 .test.ts，读测试可以快速判断成熟度。",
  "2. 每条结论必须有双方 path:line 证据，全部是你真实打开过的行；泛泛而谈（如「架构不如人」无证据）不要。",
  "3. 只读分析：不修改、不创建任何文件；不要进入 .commandcode/、.zion-mcp/、.vitest/ 目录；绝不执行任何闭源产品的二进制，只读它们盘上的分发文件。",
  "4. 参考目录用 Read 打不开时，改用 Bash 的 rg / cat / strings 读。",
  "5. 结论全部用中文。",
].join("\n");

const dims: Dimension[] = [
  {
    name: "检索与代码库理解",
    charter:
      "模型对陌生大库的「理解带宽」差在哪：TNT 的 retrieval/、tools/codebaseSearch、lsp/ 现状，对照参考项目的语义/AST 检索、LSP 符号能力（定义、引用、诊断消费）、仓库地图或结构概览注入、依赖图、测试定位能力。",
    refs: [
      REF_ROOT + "/opencode/（LSP 集成最完整）",
      REF_ROOT + "/pi/（ctx 上下文模块）",
      REF_ROOT + "/gemini-cli/",
      REF_ROOT + "/codex/",
    ],
  },
  {
    name: "Agent 执行引擎",
    charter:
      "执行引擎的健壮与编排深度：loop/ 的预算/循环检测/终止策略、并行工具调用、subagent/ 的编排深度（内置代理种类、隔离、结果回灌）、计划模式、后台任务、失败重试与可中断恢复，对照参考项目的 turn 引擎与任务编排。",
    refs: [
      REF_ROOT + "/codex/",
      REF_ROOT + "/pi/",
      REF_ROOT + "/omp/",
      REF_ROOT + "/Open-ClaudeCode/",
    ],
  },
  {
    name: "上下文工程",
    charter:
      "上下文组装与消耗效率：agent/systemMessage 的分层与缓存前缀稳定性、promptProfiles、compaction/（micro/auto 压缩触发与质量）、loop/contextBudget 的计量口径、会话记忆与规则文件（AGENTS.md 类）、token 账本，对照泄露提示词语料中一线产品的上下文策略与分层写法。",
    refs: [
      REF_ROOT + "/system_prompts_leaks/（按厂商分目录的泄露提示词）",
      REF_ROOT + "/pi/",
      REF_ROOT + "/gemini-cli/（上下文压缩）",
      REF_ROOT + "/claude-code/",
    ],
  },
  {
    name: "工具与能力面",
    charter:
      "内置工具的广度与质量：编辑形态（applyPatch 与参考产品的编辑工具对比）、搜索、bash（超时/后台任务/输出截断策略）、lint/typecheck 自动反馈环、web 检索、图片输入、todo/计划工具；同时对比各家工具 schema 与工具描述的写法工程（描述即提示词）。",
    refs: [
      REF_ROOT + "/claude-code/",
      REF_ROOT + "/codex/",
      REF_ROOT + "/opencode/",
      REF_ROOT + "/gemini-cli/",
    ],
  },
  {
    name: "安全与权限",
    charter:
      "权限与隔离的严谨度：permissions/ 的规则引擎、bashCommandRule 的命令解析严谨度、auto 模式的边界、hooks 机制、沙箱或工作区隔离、密钥与注入防护，对照参考产品的沙箱方案与权限模型。",
    refs: [
      REF_ROOT + "/codex/（沙箱方案）",
      REF_ROOT + "/claude-code/",
      REF_ROOT + "/opencode/",
      REF_ROOT + "/pi/",
    ],
  },
  {
    name: "闭源发行物对照",
    charter:
      "从本地安装的闭源/官方发行物中提取能力情报。注意 Cursor 有两个发行物、价值不同：cursor-agent CLI 看提示词与工具 schema；Cursor IDE（deb 装在 /usr/share/cursor）的 resources/app 才是能力本体——extensions/ 下全套 agent 栈（cursor-agent-host/worker/exec、cursor-local-agent-runtime、cursor-mcp、cursor-browser-automation、cursor-computer-use、cursor-file-service 等）与检索/索引后端（retrieval 类扩展、cpp 符号服务）、out/ 主进程、product.json 能力开关。官方 claude code 的 npm 包与原生二进制、commandcode 的分发文件同样提取：系统提示词结构、工具清单与 schema、上下文/权限策略线索；再结合已解码的 CURSOR_AGENT.md 与 COMPOSER_REFERENCE.md，找出 TNT 未覆盖的能力或策略。二进制用 Bash 的 strings/rg -a 提取长字符串（提示词、JSON schema 键名）；npm dist 的 cli.js 直接 rg；.asar 内文件内容未压缩，rg -a 可直接搜，也可用全局 asar CLI 只列目录清单；绝不执行这些二进制。",
    refs: [
      "/usr/share/cursor/resources/app/（Cursor IDE 本体：product.json 能力开关、out/ 主进程、extensions/ 全套 cursor-* agent 与检索扩展、node_modules.asar）",
      "/home/lin/.local/bin/cursor-agent（cursor-agent CLI，顺藤摸瓜找到真实分发文件）",
      "/home/lin/.nvm/versions/node/v24.15.0/lib/node_modules/@anthropic-ai/claude-code/（官方 claude code；原生二进制在其 node_modules/@anthropic-ai/claude-code-linux-x64/claude）",
      "/home/lin/.nvm/versions/node/v24.15.0/lib/node_modules/command-code/（commandcode 的 npm 包；/opt/Command Code 与仓库内 .commandcode/ 只读参考）",
      REF_ROOT +
        "/CURSOR_AGENT.md 与 " +
        REF_ROOT +
        "/COMPOSER_REFERENCE.md（已解码的逆向笔记）",
      REF_ROOT + "/system_prompts_leaks/Cursor/",
    ],
  },
];

const priorAnalystPrompt = [
  "你是「既有研究对账员」。参考仓库里有一批针对 TNT 的研究文档（写于 2026-10-15 前后，基线 TNT HEAD=2b21f6eaa；此后 TNT 已落地大量改动）。你的任务：逐项核对这批文档的建议在当前工作区（就是 TNT 仓库）的真实状态，防止后续汇总重复推荐已完成项、漏掉仍然成立的高价值项。",
  "",
  "文档（绝对路径）：",
  "- " + REF_ROOT + "/REFERENCE_REVIEW_TNT.md（主清单，逐条带双方证据）",
  "- " + REF_ROOT + "/NEXT_GOAL_TNT.md、STRUCTURE_PLAN.md、ARCHITECTURE.md",
  "- " + REF_ROOT + "/SYSTEM_PROMPT_CANON.md（每行标注了 in TNT 是否已落地）",
  "",
  "要求：",
  "1. overview 3-5 句：这批文档覆盖什么、质量如何、与当前 TNT 的总体偏差（注意路径已从 extensions/cli 迁到 packages/cli）。",
  "2. 挑影响最大的 ≤15 条建议逐条对账：status=done（当前树已实现，给 path:line 证据）/ partial / not-done（仍成立且值得做）/ stale（被架构演进作废或前提不成立）。note 一句话。可用 Bash 跑 git log 确认落地时间，但判定以当前代码为准。",
  "3. SYSTEM_PROMPT_CANON.md 中标 in TNT 的行抽主要几条核对，不实的列入 items（status=stale，note 写实情）。",
  COMMON_GUARDS,
].join("\n");

function analystPrompt(d: Dimension): string {
  return [
    "你是 TNT CLI「" + d.name + "」维度的对比分析员。",
    "",
    "背景：TNT（本仓库 packages/cli，Continue 分支的终端编码代理）目标是达到一线编码代理产品的工程化水准（对代码库的深度理解、高质量代码产出、软件工程自动化）。此前一轮 P0-P2 质量治理（CI、安全加固、TUI 稳定）已落地，本轮找的是「产品能力」层面的剩余差距。",
    "",
    "你的维度：" + d.charter,
    "",
    "TNT 侧入口（相对仓库根，当前工作区就是 TNT 仓库）：",
    "- packages/cli/src/ 全部源码（agent/、loop/、tools/、permissions/、compaction/、subagent/、retrieval/、lsp/、mcp/、hooks/、session/、stream/、services/、ui/）",
    "- core/（共享 SDK）按需查阅",
    "",
    "重点参考（绝对路径；其余项目 " +
      REF_ROOT +
      " 下 Open-ClaudeCode、baocode、peri、reasonix、dsh 可自行查阅）：",
    ...d.refs.map((r) => "- " + r),
    "",
    "产出要求：",
    "1. 先盘点 TNT 该维度现状（inventory 3-5 句）：有什么、成熟度如何。",
    "2. 找 ≤6 条真实差距，按 impact 降序；gap 一句话说清「参考做了什么而 TNT 没做到/做得弱」。",
    "3. recommendation 明确「直接搬运 / 改造落地 / 需自研」与文件级切入点。",
    "4. impact=high 只给直接拉开产品力差距的缺失（用户可感知的智能或可靠性差距）；风格差异、锦上添花给 low。",
    COMMON_GUARDS,
  ].join("\n");
}

function confirmerPrompt(d: Dimension, analysis: AnalysisResult): string {
  return [
    "你是「" +
      d.name +
      "」维度的独立复核员，用与分析员不同的视角核对下面这份差距清单。",
    "逐条：",
    "1. 打开每条 tntEvidence 与 referenceEvidence 指到的文件行，确认行号真实存在、行为描述与代码一致；",
    "2. 判断 recommendation 是否与 TNT 架构兼容（one engine four surfaces：一个引擎驱动 TUI/headless/serve/ACP 四面；模块化 + eslint 严格限额 max-lines 500/max-statements 50），文件级切入点是否真实存在；",
    "3. 证据不实、描述夸大或建议不可落地 → confirmed=false 并在 reviewNote 说明；impact 虚高可降级并在 reviewNote 注明。",
    "不新增条目，不改写 gap 文本本身；全部条目按原顺序返回，回填 confirmed 与 reviewNote。",
    "只读：不修改任何文件。中文输出。",
    "",
    "清单：" + JSON.stringify(analysis.findings),
  ].join("\n");
}

function priorConfirmerPrompt(audit: PriorAudit): string {
  return [
    "你是既有研究对账的独立复核员。逐条核对下面的对账结果：done/partial 的 evidence 行号是否真实存在且确已实现；not-done 是否确实未实现（在当前 TNT 树上再搜一遍）；stale 的判定是否成立。不实的 verified=false 并写 reviewNote。全部条目按原顺序返回。",
    "只读；中文。",
    "",
    "对账结果：" + JSON.stringify(audit.items),
  ].join("\n");
}

artifact.board("progress", {
  title: "七路分析进度",
  key: "dimension",
  status: "stage",
  columns: ["分析中", "复核中", "已完成", "失败"],
  cardTitle: "dimension",
});

phase("七路并行：既有研究对账 + 六个能力维度对比，逐条独立复核");

// 既有研究对账链：与其他六条维度链并发，链内串「对账 → 复核」
const priorPromise = (async (): Promise<PriorAudit> => {
  report({ dimension: "既有研究对账", stage: "分析中" }, "progress");
  try {
    const audit =
      await agent("对账·既有研究").ask<PriorAudit>(priorAnalystPrompt);
    report({ dimension: "既有研究对账", stage: "复核中" }, "progress");
    const checked = await agent("复核·既有研究").ask<PriorAudit>(
      priorConfirmerPrompt(audit),
    );
    report({ dimension: "既有研究对账", stage: "已完成" }, "progress");
    return checked;
  } catch (e) {
    report({ dimension: "既有研究对账", stage: "失败" }, "progress");
    return { overview: "对账链失败：" + String(e), items: [] };
  }
})();

// 六个能力维度链：每条链内「分析 → 独立复核」串行，链间并发
const gapPromises = dims.map(async (d): Promise<DimensionResult> => {
  report({ dimension: d.name, stage: "分析中" }, "progress");
  try {
    const analysis = await agent("分析·" + d.name).ask<AnalysisResult>(
      analystPrompt(d),
    );
    report({ dimension: d.name, stage: "复核中" }, "progress");
    const check = await agent("复核·" + d.name).ask<AnalysisResult>(
      confirmerPrompt(d, analysis),
    );
    report({ dimension: d.name, stage: "已完成" }, "progress");
    for (const f of check.findings) report({ ...f, dimension: d.name });
    return {
      dimension: d.name,
      inventory: analysis.inventory,
      findings: check.findings,
    };
  } catch (e) {
    report({ dimension: d.name, stage: "失败" }, "progress");
    return {
      dimension: d.name,
      inventory: "该维度分析链失败：" + String(e),
      findings: [],
      error: String(e),
    };
  }
});

log("七条分析链已启动：1 条既有研究对账 + 6 个能力维度，每条链内独立复核");

// 汇总需要每条链的复核结果与对账状态，必须等全部完成（去重依赖完整的输入）
const [prior, ...dimResults] = await Promise.all([
  priorPromise,
  ...gapPromises,
]);

const allFindings = dimResults.flatMap((r) => r.findings);
const confirmedCount = allFindings.filter((f) => f.confirmed).length;
const confirmedHigh = allFindings.filter(
  (f) => f.confirmed && f.impact === "high",
).length;
const unconfirmedHigh = allFindings.filter(
  (f) => !f.confirmed && f.impact === "high",
).length;
const failedChains = dimResults.filter((r) => r.error).map((r) => r.dimension);
log(
  "复核完成：" +
    allFindings.length +
    " 条差距，其中 " +
    confirmedCount +
    " 条确认（高影响 " +
    confirmedHigh +
    "）；未确认高影响 " +
    unconfirmedHigh +
    (failedChains.length > 0 ? "；失败链：" + failedChains.join("、") : ""),
);

phase("汇总成产品差距报告");

const synthesizer = agent("首席汇总", {
  system:
    "你是资深编码代理架构师，输出克制、证据导向、面向执行。工作区里可能有其他代理的在途改动，除指定报告文件外不得触碰任何文件。如果输入相互矛盾或无法完成，明确说出而不是编造。",
});

const synthPrompt = [
  "把本轮七路分析汇总成一份可执行的差距报告，写到工作区根目录 " +
    REPORT_PATH +
    "（只写这一个文件）。",
  "",
  "输入一：既有研究对账（旧文档建议在当前树上的状态，JSON）：",
  JSON.stringify(prior),
  "",
  "输入二：六个能力维度的差距与复核状态（JSON）：",
  JSON.stringify(dimResults),
  "",
  "报告结构（中文，面向 TNT 维护者，每条结论可溯源到证据）：",
  "1. 执行摘要：TNT 离一线产品最核心的差距，3-5 句；",
  "2. 既有研究对账：REFERENCE_REVIEW_TNT 等旧文档建议的 done/partial/not-done/stale 统计与关键条目（哪些旧建议可以收口、哪些仍开放）；",
  "3. 确认差距清单：只收 confirmed 条目，按 impact 分组、跨维度合并同类项，每条附双方证据与落地判断（搬运/改造/自研）；",
  "4. 待人工复核：未确认但 impact=high 的条目，附复核意见；",
  "5. 行动路线图：P0（搬运即可见效）/ P1（改造落地）/ P2（自研或远期）；每项写清做什么、涉及 TNT 文件、参考来源与机制；",
  "6. 风险与依赖：包括落地约束——TNT 的代码注释与文件名不得出现任何参考产品名，阈值须按 TNT 自身上下文重标定。",
  "",
  "背景基调：TNT 是 one engine four surfaces 架构（一个引擎驱动 TUI/headless/serve/ACP 四个面），模块化 + eslint 严格限额（max-lines 500 / max-statements 50 / complexity 30），spec/ 目录有双向守护测试，改动需带测试。",
  "写完返回 Roadmap（reportPath 填 " + REPORT_PATH + "）。",
].join("\n");

const roadmap = await synthesizer.ask<Roadmap>(synthPrompt);

phase("独立审读并修订报告");

const critique = await agent("独立审读员").ask<Critique>(
  [
    "你是独立审读员，此前没参与这份报告的撰写。报告文件：" + roadmap.reportPath,
    "只凭报告文本审读，最多抽查 3 条高影响结论的代码证据（只读，不改任何文件）。回答：",
    "1. 哪些表述会误导维护者（夸大、已过时、因果不通）？",
    "2. 对决策重要但缺失的内容是什么？",
    "3. 哪条建议证据不足？",
    "verdict 给一句总评。中文。",
  ].join("\n"),
);

const revised = await synthesizer.ask<Roadmap>(
  [
    "审读意见（JSON）：" + JSON.stringify(critique),
    "按意见修订 " +
      REPORT_PATH +
      "（同名覆盖）：修正误导表述、补缺失内容、给证据不足的建议降级或补证；只改有问题的部分。",
    "返回更新后的 Roadmap（topPriorities 可调整）。",
  ].join("\n"),
);

try {
  await artifact.file("report", revised.reportPath, {
    title: "TNT 产品能力差距报告",
    description:
      "七路分析（既有研究对账 + 六个能力维度）汇总的确认差距与 P0-P2 路线图。",
    primary: true,
  });
} catch {
  await synthesizer.ask<string>(
    REPORT_PATH + " 缺失或不可读，请重新把完整报告写入该路径。",
  );
  await artifact.file("report", revised.reportPath, {
    title: "TNT 产品能力差距报告",
    description:
      "七路分析（既有研究对账 + 六个能力维度）汇总的确认差距与 P0-P2 路线图。",
    primary: true,
  });
}

const finalReport: WorkflowReport = {
  conclusion:
    "七路分析完成：" +
    allFindings.length +
    " 条差距中 " +
    confirmedCount +
    " 条通过独立复核（高影响 " +
    confirmedHigh +
    " 条），" +
    unconfirmedHigh +
    " 条高影响未通过复核已单列待人工复核。报告见 " +
    revised.reportPath +
    "。最优先：" +
    revised.topPriorities.join("；"),
  findings: allFindings.map((f) => ({
    where: f.tntEvidence,
    what: f.gap + "（建议：" + f.recommendation + "）",
    evidence:
      f.tntEvidence +
      " ↔ " +
      f.referenceEvidence +
      (f.reviewNote ? "｜复核：" + f.reviewNote : ""),
    status: f.confirmed ? "verified" : "unconfirmed",
    severity: f.impact,
  })),
  verified: [
    "六个维度每条差距均由独立复核员重新打开双方证据文件核对行号与行为描述",
    "既有研究文档的建议逐项与当前代码对账，防止重复推荐已完成项",
    "终稿经未参与撰写的独立审读员审读并修订",
  ],
  notCovered: [
    "REA 对闭源二进制（官方 claude code 原生包、cursor-agent、Cursor IDE 主程序）的深度逆向未展开——本轮只做文件级提取，需要更深的二进制级分析时可用本地 REA 逐项跟进",
    "各代理在真实任务上的效果与成本基准（跑分对比）未做，本轮是静态能力对照",
    "TUI 交互面已有专项差距报告（TUI-GAP-ANALYSIS-2026-10-25.md），本轮只覆盖引擎与能力层",
  ],
};
return finalReport;
```

### 附录 A.1 复跑前的两处必改（可续跑性）

当前脚本在 7 条并发链里直接 `report()`，落盘顺序随完成时序变化，导致 journal 无法确定性重放（本轮 errored 的直接原因）。复跑前二选一：

1. **推荐**：删除链内的 `report(...)`，在 `Promise.all` 之后按 `dimResults` 的固定顺序统一 report（看板仍可用，但变成完成后的汇总展示，不再是实时进度）；
2. 保留实时看板：给每条链的 report 加固定序号并等待全部完成后再发送（实现更复杂，收益有限）。

若不需要续跑能力，保持现有脚本也能跑通——但一旦 provider 中断就无法恢复，只能整轮重跑。附录 A 的脚本已按"可运行"保留原样，未擅自改动。
