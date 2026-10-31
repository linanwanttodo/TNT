# 优化工作日志

本文件记录每一项优化的：做了什么、为什么、依据来源、验证方式。后续会话可直接查阅，避免重新推理或误改。

## 分支 fix/cache-prefix-stability（2026-10-31 起）

### 1. 前缀稳定性修复（commit 71a3a96bd）

**做了什么：**

- `packages/cli/src/agent/systemMessage.ts`：`getGitStatus()`、`isGitRepo()`、`sessionDate()`（新增）全部改为进程级快照（首次调用后 memoize）。
- `packages/cli/src/stream/turnState.ts` + 新文件 `systemPromptSeries.ts`：`TurnState.systemPrompt` 不再每 turn 重置，改为从按 promptCacheKey 键控的会话级注册表借用；带自定义 systemMessage 的委派运行（子代理）用独立条目，避免父子互相污染。
- `packages/cli/src/tools/selection/requestTools.ts:75` 与 `streamChatResponse.ts` 的 contextBudget reminder：改读 `getModelContextLimit(model)`，使 model 级 `contextLength` 配置生效（原先只读 `defaultCompletionOptions.contextLength`，绕过模型级配置）。

**为什么：**

- git status 块的提示词文本承诺"a snapshot in time / will not update during the conversation"，但原实现每轮 `execSync("git status --porcelain")`——每碰一个文件前缀尾部就变字节，缓存整体作废，且契约自相矛盾。
- TurnState 每 turn 重置 `systemPrompt: { updates: [] }`，导致每个新 turn 第一轮 `previous === undefined` → 判定 rewrite → 清空 updates、重发 head、整段重计费；日志里每轮都出现误导性的 "System prompt rewritten, cached tokens rebilled"。
- 上下文窗口旁路导致用户在 config.yaml 配 1M contextLength 时，工具延迟和上下文提醒仍按 200k 默认值计算。

**依据来源（参考实现调研，此前会话结论）：**

- claude-code：git status memoize + 1h TTL 锁会话状态；beta 头 latched。
- opencode：日期/环境作为 DB 持久化条目，只在变化时渲染。
- pi：section-diff 式 system prompt，跨请求保持字节稳定。
- atomcode：CI 强制 wire prefix append-only。

**验证：**

- `npx vitest run src/stream`（212 项）+ `src/agent src/tools`（609 项）全绿。
- `systemPrefixFingerprint.test.ts` 守卫确认静态 spine 四形状 digest 未变。
- 新测试 `systemPromptSeries.test.ts`（4 项）；`turnState.test.ts` 第一条改写为新契约（跨 turn 继承同一 series 对象）。
- tsc --noEmit 通过。

### 2. prune 循环线性化（commit 9b2478324）

**做了什么：** `requestPreparation.ts` 的 `pruneHistoryToContextLimit` 不再每剪一条就 `validateContextLength` 全量重编码（O(n²)）；改为 system 消息、updates、工具列表各算一次，每条消息 token 数算一次，剪一条减一条。

**为什么：** 长 会话下剪枝循环对全历史做 O(n) 次 tokenize，纯浪费。算术保持一致（含 updates 每条 encode+5 的开销；顺带修掉了原实现因 `hasSystemInHistory` 判断把主 system 消息漏计的问题）。

**验证：** `src/stream` 212 项全绿（9 个测试文件的 tokenizer mock 补齐 `countToolDefinitionTokens` / `getModelContextLimit` / `getModelMaxTokens` 导出），tsc 通过。

### 3. undo 栈上限（commit 8ab840b08）

**做了什么：** `ChatHistoryService` 的 `past` 栈上限 20 条（`MAX_UNDO_STEPS`），超出丢最旧；补测试。

**为什么：** 每次 commit 全量浅拷贝历史入栈且无上限，长会话持有 O(提交数) 份全历史副本；20 步也已是用户手速能达到的范围。

**验证：** `ChatHistoryService.test.ts` 35 项全绿，含新增上限测试。

### 4. 插件加载缓存（commit 4ebaf9ec9）

**做了什么：** `loadAllPlugins()` 按 cache roots 的 mtime 指纹 memoize；新增 `invalidatePluginCache()` 供原地修改插件文件后手动失效。

**为什么：** 调用点在每轮关键路径上（systemMessage 的 outputStyle、subagent 名册、hook 表、MCP 声明），原实现每轮重新遍历所有插件目录多次，纯 I/O 浪费。

**依据来源：** claude-code 对 git 状态/上下文的 memoize 模式；TNT 自身 loader.ts 原注释即承认这是启动 + 每轮都会走的代码。

**验证：** loader.test.ts 20 项全绿（含新增"安装后指纹变化自动重载"测试）；src/plugins 全量 136 项全绿；tsc 通过。安装/卸载路径已接入 invalidatePluginCache()（pluginInstall.ts:253、:361）。

### 5. shouldAutoCompact 去 debug 全量 tokenize（commit 72f54865b）

**做了什么：** `compaction/index.ts` 的 "Context usage check" 日志不再为打印 historyTokens 而对全历史跑 `countChatHistoryTokens`。

**为什么：** 该字段对判定无用（决策已用 measured 或 countTotalInputTokens 的结果），每次压缩检查白白重编码全部消息。

**验证：** src/compaction 100 项 + autoCompaction/measuredCompaction 13 项全绿，tsc 通过。

### 6. session meta 冗余重写（commit c2a527deb）

**做了什么：** `session/store.ts` 的 `sync()` 在本次 diff 未产生任何 transcript 记录（`records.length === 0`）时提前返回，不再执行 `buildMeta()`（含一次 statSync）和 `writeMeta()`（temp+rename+chmod 的原子重写）。补测试：无变更的 sync 不改 meta.json 字节与 mtime，`updatedAt` 保持最后一次真实变更的时间。

**为什么：** 勘误——最初分析说"session meta 每次变更全量重写"，实际读码后确认 transcript 本身已是 append-only（appendRecords），真正的浪费点是 meta.json 派生缓存：`saveSession()` 会在一个 turn 内被多次调用（ChatHistoryService 每次 stateChanged、useChat 各钩子），turn 内后几次调用往往零 diff，却仍各付一次 statSync + 原子重写。无变更时缓存本就准确，跳过同时让 `updatedAt` 与 `list()` 排序只反映真实变更。

**依据来源：** claude-code 的不变即不写 memoize 模式（同第 1 项）；store.ts 原注释即声明 meta.json 是 "derived cache for listing"，派生缓存无变化不重写是该契约的自然延伸。

**验证：** src/session + ChatHistoryService + ui/hooks 共 21 文件 193 项全绿（含新增第 12 条测试），tsc 通过。

### 7. headless 懒加载 TUI-only 服务（commit c667c5606）

**做了什么：** `services/index.ts` 的 `initializeServices` 在 headless 模式（`-p`、ACP worker、review worker）只急切加载核心九项（API_CLIENT、AGENT_FILE、CONFIG、MODEL、MCP、TOOL_PERMISSIONS、SYSTEM_MESSAGE、CHAT_HISTORY、HOOKS）；FILE_INDEX、GIT_AI_INTEGRATION、QUIZ、RESOURCE_MONITORING、STORAGE_SYNC 留给首次请求时加载。TUI 保持全量急切初始化。顺带把 `headless` 传给 `updateService.initialize()`（其 `doInitialize(headless?)` 本就支持，用于跳过自动更新网络检查，但一直没接到）。

**为什么：** 逐个查了急切集的成本：FILE_INDEX 启动即全工作区 fdir 爬取（1 秒超时竞速），但唯一消费方是 TUI 的 @ 文件搜索（FileSearchUI/UserInput）；GIT_AI 启动即 `exec("git-ai --version")` 子进程探测，消费方 tools/index.tsx 直接走实例且对未探测状态（null）天然安全；QUIZ/STORAGE_SYNC 无 headless 用途。这些在 headless 下是纯启动延迟。

**依据来源：** pi 的按需初始化（surface 不需要的服务不启动）；claude-code 的 headless 冷启动优先（首 token 延迟优先于后台完备性）。

**验证：** src/services + acp + review + commands 共 77 文件 662 项全绿，tsc 通过。MCP headless 握手语义未动（MCP 在核心九项里，headless 仍等握手并在失败时报错）。

## 待办（按报告优先级）

- P0（已确认就位，无需改）：DeepSeek usage 归一（openai-adapters/util.ts normalizeUsage 已认 `prompt_cache_hit_tokens`，OpenAI.ts 两条路径已接入，有测试）
- P2（已完成）：14 个服务启动期急切初始化——见第 7 项；headless 仍阻塞 MCP 握手（属 `-p` 的语义需求：工具清单要先于首请求确定，故保留）
- /team 专家团 v1（等设计评审）：六个人格进 builtInAgents.ts，Claude Code 的开发能力作为提示词与 agent 循环纪律的主要参考；Codex 的 UI 设计能力、pi 的纯净性为辅。

---

## 记录约定

- 位置固定：`docs/worklogs/`（git 跟踪，跨会话可查；`.md` 不进 docsParity 发布站守卫）。
- 每完成一个优化项并提交后，立即在本文件追加一节：做了什么 / 为什么 / 依据来源 / 验证方式。
- 一天多项工作可用日期命名的独立文件，长期约定类内容（如 /team 设计决策）写在 `docs/superpowers/specs/`。
