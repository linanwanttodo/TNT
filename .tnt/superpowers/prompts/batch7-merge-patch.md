# 任务：TNT 系统提示词分节注册表 + 增量重述（批次 7）

## 0. 一句话目标

把 `packages/cli` 的系统提示词从"每轮整段重建、事后检测失效"升级为
"分节注册表 + 对可变化节做增量重述（diff 重发）"，让长会话中途的变化不再
作废已缓存的请求前缀。结构重构在前，diff 机制在中，基线生命周期在后，
分三次提交，每次验证门全绿才进下一步。

## 1. 项目背景（零上下文）

- 仓库：`/home/lin/All_projects/GithubProjects/continue`，产品是 TNT——
  Continue 的社区分支，只保留 CLI 形态的编码 agent。
- 主战场：`packages/cli`（TypeScript，ESM，Node ≥ 20，Vitest）。
- 基线：HEAD = `99e991467`（"Tell the model what survives an early stop"）。
  动手前 `git log --oneline -3` 确认。
- 引擎入口：`packages/cli/src/stream/streamChatResponse.ts` 是唯一的回合循环；
  系统提示词由 `services.systemMessage.getSystemMessage(mode)` 在请求时注入。
- 缓存前缀工程是本项目核心卖点：请求前缀（system + tools + 消息头）字节稳定时
  provider 的 prompt cache 才命中；本项目用 `cache/prefixState.ts` 事后判定
  full / passthrough / invalidated。

## 2. 必读文件与已核验的现状（不要重新猜，直接按此核对行号）

### 2.1 `packages/cli/src/agent/systemMessage.ts`（约 589 行）

- `baseSystemMessage`（约 116 行起）：CLI 自带的行为条款文本（18 条纪律已在位，
  **本次不要改条款文本**）。
- `environmentSection()`（约 201 行）：环境块 + `<context name="gitStatus">`，
  gitStatus 是"会话开始时的快照，不会更新"。
- `SystemMessageSection` 接口（约 268 行）：
  ```ts
  export interface SystemMessageSection {
    readonly name: string;
    readonly text: string;
    readonly volatile: boolean; // 会话中途可能变化：模式、输出风格、规则文件
  }
  ```
  注意：stable/volatile 的区分**已经存在**，本次在此基础上加 diff 能力，
  不要重复发明。
- `buildSystemMessageSections(mode, additionalRules?, format?, headless?, profile?)`
  （约 440 行）：用一串 `sections.push(...)` 按序组装，每个节都带 name。
- `constructSystemMessage(...)`（约 573 行）：对外的组装入口。
- 组装顺序（与 `packages/cli/ARCHITECTURE-tnt.md` 的 "The cached prefix" 节一致，
  **不要改顺序**）：base → planMode → promptProfile → headless / jsonOutput →
  outputStyle → userRules（规则放最后，用户改文件只动尾巴）。

### 2.2 `packages/cli/src/stream/systemPromptPolicy.ts`

- `SystemPromptAction = "keep" | "rewrite" | "append"`，`decideSystemPrompt(...)`
  决定 mid-session 变化是继续用旧前缀（keep）、重写（rewrite）还是把变化作为
  **对话侧的追加系统消息**（append）。第二步要复用它的 append 通道。

### 2.3 `packages/cli/src/cache/prefixState.ts`

- `CachePrefixState = "full" | "passthrough" | "invalidated"`；
  另有 `COLD_PREFIX_STATE`、`COMPACTION_PREFIX_STATE`、
  `MIN_CACHEABLE_PREFIX_TOKENS`、`CacheMissOwner = "prefix" | "provider"`。
  压缩相关状态已被这个模块跟踪，第三步的基线清空要挂在这条线上。

### 2.4 压缩

- `packages/cli/src/compaction/`：主压缩流程 + `prefixPreservation.ts`
  （构建保留缓存前缀的摘要请求）+ `measuredContext.ts`（实测 usage）。
  压缩完成的位置就是第三步清 diff 基线的挂点。

### 2.5 现有守卫测试（不许删，不许弱化）

- `src/agent/systemMessage.sections.test.ts`（节命名/顺序/volatile 对账）
- `src/agent/systemMessage.gitStatus.test.ts`（快照声明精确措辞）
- `src/agent/systemMessage.instructionLayers.test.ts`（RULES_PREAMBLE 位置）
- `src/agent/systemMessage.outputStyle*.test.ts`
- `src/cache/prefixState.test.ts`
- `src/architecture.test.ts`（分层边界）

## 3. 硬约束（违反即返工）

1. 验证门三条，在 `packages/cli` 目录下全绿：
   `npx tsc --noEmit`、`npx vitest run`、`npx prettier --check "src/**/*.{ts,tsx}"`。
   全量 vitest 约 540 个文件 / 4300 个用例，跑一次约 55 秒。
2. 提交：Conventional Commits；祈使句；主题行 < 72 字符；结尾无句号。
   **不得**出现 `Co-Authored-By`、`Generated with`、任何 AI 工具名
   （Claude / Codex / Gemini / Copilot / Cursor 等一律不写）；
   **不得**出现 `Qodana` 字样。只使用用户本人署名。
3. 不允许新增依赖（不引 zod、不引任何 TUI/ink 分支、不引 diff 库）。
4. 文件内容纯 ASCII，允许全角 CJK 标点；禁 emoji。
5. 注释只描述机制本身（写"为什么"，不写步骤流水账），
   **注释里不得出现任何参考项目名**（不要写 codex / claude 等出处）。
6. 缓存不变量：
   - 会话中途的变化只能**追加在对话侧**（in-history），
     不得改写已经发出去的前缀字节；
   - 不新增缓存断点（本项目刻意只保留少量断点，加断点会击穿命中率）；
   - 不改各节的文本语义，只加结构能力。
7. 不改 18 条行为条款文本；不碰 `ide/`、GUI、`packages/sdk` 生成代码。

## 4. 分步实施

### 第一步：注册表化（行为完全不变，先做特征测试）

做法：

1. 先写**特征测试**：把当前 `constructSystemMessage(...)` 在若干配置组合
   （default / plan / headless / 带 format / 带 profile / 有规则文件）下的输出
   全文快照下来（直接字符串相等断言，不依赖外部快照文件）。
2. 把 `buildSystemMessageSections` 里的顺序 `push` 改成冻结注册表：
   ```ts
   interface SectionDefinition {
     readonly id: string;              // 与现有 name 一一对应
     readonly kind: "stable" | "volatile" | "diffable";
     build(ctx: BuildContext): SystemMessageSection | null; // null = 本节不适用
   }
   const SECTION_REGISTRY: readonly SectionDefinition[] = Object.freeze([...]);
   ```
   要求：模块加载时断言 id 唯一（重复即抛错）；kind 用穷尽检查
   （`satisfies` / switch 的 `never` 兜底），新增定义必须显式选 kind。
3. 逐组合跑特征测试，**输出字节必须与重构前完全一致**（一个字符都不能差，
   包括换行）。特征是本次唯一的行为保证。
4. 保持 `SystemMessageSection` 接口兼容（外部有测试与调用方 import）。

测试：

- 特征测试全组合通过（重构前后逐字节一致）；
- 新增注册表守卫：重复 id 抛错、空 id 抛错、每个定义 build 返回的节名等于 id；
- 现有 `systemMessage.sections.test.ts` 全绿。

提交：`refactor(agent): registry for system message sections`

### 第二步：对可变化节做增量重述（diff 重发）

做法：

1. 每节可产出**快照**：`{ id, hash, text }`，只保留"决定要不要再告诉模型"所需
   的比较字段（hash 用简单字符串哈希即可，不必引库）。快照挂在会话侧
   （内存状态即可，随会话生命周期存亡，不需要落盘）。
2. 引入三态判定：**Absent**（历史里没有该节旧版本，例如首轮或压缩后）→
   全量注入；**Known 且 hash 相同** → 整节省略；**Known 且不同** → 增量重述。
3. `renderDiff(prev)`：
   - `gitStatus` / 环境类节：按行比较，只发**变化项**；被移除的项**显式渲染**
     `status="unavailable"`（沉默不等于删除，模型必须知道某条不见了）；
   - `outputStyle` / `userRules` 等文本型变化：走
     `systemPromptPolicy.decideSystemPrompt` 的 **append** 通道，作为对话侧
     追加系统消息发出，前缀首字节不动；
   - 不变的节整节省略。
4. **防骗校验**：发 diff 前确认上一版该节文本**确实还在保留的历史窗口里**
   （简单做法：在保留窗口内的系统消息/控制项里检索上一版节文本或其标记；
   找不到就退回 Absent 全量注入）。理由是压缩可能已经把旧片段吃掉，
   "我曾宣布过"这个标志位单独不可信。
5. 观测：日志里记录每节的判定结果（full / unchanged / diff），不新增 UI。

测试（都要有）：

- 环境节只发变化项，移除项出现 `status="unavailable"`；
- 两轮完全相同 → 第二节整节省略（无输出）；
- mid-session 切换 outputStyle → 请求前缀字节不变（沿用
  `prefixState` 的判定测试形状），变化只出现在追加的系统消息里；
- 无旧快照 → 全量注入；
- 旧节文本已不在保留窗口 → 退回全量注入（构造一次压缩后的场景）。

提交：`feat(cache): diff-based section reinjection with retained-fragment guard`

### 第三步：基线生命周期（压缩/回滚清空）

做法：

1. 压缩流程完成的位置（`compaction/` 与流循环里的压缩分支，与
   `COMPACTION_PREFIX_STATE` 的处理同处）清空全部节的 diff 基线 →
   下一轮自然全量重注入（Absent）。
2. 回合回滚 / 历史截断（edit message、rewind 一类入口）同样清空基线。
3. 基线清空必须幂等、可重复调用。

测试：

- 压缩后下一轮全量重注入（断言第二节输出包含完整节文本而非省略）；
- 连续两次清空不抛错、结果一致。

提交：`feat(compaction): clear section baselines after compaction`

## 5. 验收清单（交付前逐条自查）

- [ ] 三次提交，每条 Conventional Commits，无 AI 名、无 Co-Authored-By，主题 < 72 字符
- [ ] 第一步重构前后 `constructSystemMessage` 全组合输出逐字节一致（有测试）
- [ ] 注册表重复 id / 空 id 有守卫测试
- [ ] diff 能力测试：变化项、unavailable、省略、append 通道、防骗回退
- [ ] 压缩后基线清空测试；回滚清空测试
- [ ] `npx tsc --noEmit` 0 错误
- [ ] `npx prettier --check "src/**/*.{ts,tsx}"` 通过
- [ ] 全量 `npx vitest run` 全过（偶发单例失败要复跑两次确认，不要直接归因）
- [ ] 未改 18 条条款文本、未改节顺序、未新增断点、未新增依赖
- [ ] 最终报告：改了哪些文件、三步各自的测试证据、全量测试计数

## 6. 常见坑（提前避开）

1. **不要改节顺序**，顺序本身就是缓存前缀的一部分（见 ARCHITECTURE-tnt.md）。
2. **不要把易变内容塞进稳定节**（时间、会话 id、随机值），一次就会让前缀每轮失效。
3. **哈希快照不要把整段文本序列化进日志**（体积与泄漏面）；比较字段够用即可。
4. **`volatile` 现有语义别改**：volatile 表示"用户自己会改"，diff 只处理
   "已知旧版本且变了"的情况，两者正交。
5. **append 通道优先于 rewrite**：能用追加表达的变化不要触发重写，
   重写一次等于前缀整体重计价。
6. **测试不要 mock 掉被测逻辑本身**：这次的核心是"同一输入两次输出字节相同"，
   mock 进正确性内部会让测试失去意义。
7. 若全量测试出现单例失败，先复跑确认是否偶发（本仓库存在 timing 敏感用例），
   再检查是否与本次改动相关。
