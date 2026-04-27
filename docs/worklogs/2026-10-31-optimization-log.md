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

### 4. 插件加载缓存（进行中）

**做了什么：** `loadAllPlugins()` 按 cache roots 的 mtime 指纹 memoize；新增 `invalidatePluginCache()` 供原地修改插件文件后手动失效。

**为什么：** 调用点在每轮关键路径上（systemMessage 的 outputStyle、subagent 名册、hook 表、MCP 声明），原实现每轮重新遍历所有插件目录多次，纯 I/O 浪费。

**依据来源：** claude-code 对 git 状态/上下文的 memoize 模式；TNT 自身 loader.ts 原注释即承认这是启动 + 每轮都会走的代码。

**验证：** loader.test.ts 20 项全绿（含新增"安装后指纹变化自动重载"测试）；src/plugins 全量 136 项全绿；tsc 通过。安装/卸载路径已接入 invalidatePluginCache()（pluginInstall.ts:253、:361）。

## 待办（按报告优先级）

- P1：`shouldAutoCompact` 为 debug 日志全量 tokenize（compaction/index.ts:541）
- P1：session meta 每次变更全量重写（session/index.ts）
- P0（已确认就位，无需改）：DeepSeek usage 归一（openai-adapters/util.ts normalizeUsage 已认 `prompt_cache_hit_tokens`，OpenAI.ts 两条路径已接入，有测试）
- P2：14 个服务启动期急切初始化；headless 阻塞 MCP 握手
- /team 专家团 v1（等设计评审）：六个人格进 builtInAgents.ts，Claude Code 的开发能力作为提示词与 agent 循环纪律的主要参考；Codex 的 UI 设计能力、pi 的纯净性为辅。
  EOF

---

## 记录约定

- 位置固定：`docs/worklogs/`（git 跟踪，跨会话可查；`.md` 不进 docsParity 发布站守卫）。
- 每完成一个优化项并提交后，立即在本文件追加一节：做了什么 / 为什么 / 依据来源 / 验证方式。
- 一天多项工作可用日期命名的独立文件，长期约定类内容（如 /team 设计决策）写在 `docs/superpowers/specs/`。
