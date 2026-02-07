# TNT 剩余能力差距（2026-10-26，四维手工复核版）

范围：工作流七路分析中未独立完成的四个维度（检索、引擎、上下文、工具），加上闭源发行物对照的补齐。方法：只读当前树与被审计的发行物；每条结论给出 TNT 侧 `path:line`；参考侧能给行的给行，只有发行物字符串的标明来源。工作流脚本已修好确定性，但本会话没有可提交它的工作流宿主，也没有确认配额，所以本报告是手工兜底，不是工作流产物。

## 1. 检索与代码库理解

**现状**：FTS5 trigram + BM25 与 LanceDB 向量构成两路召回，配置 reranker 角色时再排序（`packages/cli/src/retrieval/service.ts:201`、`:226`、`:252`）；tree-sitter 只切 chunk，不产边；LSP 侧已有 workspace symbol、hover、completion、diagnostics，以及本轮新增的 references、incoming/outgoing calls、document symbols；导入关系由持久化 `ImportGraph` 提供（`packages/cli/src/retrieval/importGraph.ts:281`）。

| #   | 差距                                                   | TNT 证据                                                                                                                                  | 参考证据                                                                                                                                                                  | 影响   | 建议                                                                            |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| R1  | 没有基于位置的 go-to-definition / go-to-implementation | `tools/findSymbol.ts` 只发 `workspace/symbol`（`lsp/manager.ts:193`）；无 `textDocument/definition` 或 `textDocument/implementation` 请求 | 官方 CLI 2.1.310 的 `LSP` 工具把 goToDefinition、findReferences、hover、documentSymbol、workspaceSymbol、goToImplementation、prepare/incoming/outgoing 列为同一工具的操作 | high   | 改造：复用 manager 加 `definitionAt`/`implementationAt`，暴露两个只读工具；半天 |
| R2  | 符号/调用关系不落盘                                    | References/CallHierarchy 每次向 LSP 实时查询（`lsp/manager.ts:233`、`:270`）；`ImportGraph` 只存 import 边                                | 闭源 IDE 的检索是服务端索引；外部 agent CLI 有 semantic_search 与 search_symbols，但没有 references/call 工具                                                             | medium | 保持实时查询；只有需要跨会话影响面时才加持久图                                  |
| R3  | 没有常驻/预热检索                                      | 首次 search 建索引（`retrieval/service.ts:155` ensureIndexed），无 warm grep                                                              | 闭源 IDE 的 retrieval 扩展有 `GrepClient` + `instant_grep_indexing`（内存文档上限由动态配置给出）；外部 agent CLI 的 SEMANTIC_SEARCH 自述“warm index ~10ms”               | medium | 改造：索引构建后常驻进程内；无新依赖                                            |
| R4  | 导入图覆盖面有限                                       | `extractSpecifiers` 是行锚定文本提取（`retrieval/importGraph.ts:157`），支持 TS/JS/Python/Go/Java/Rust/C；不产调用边                      | 官方 CLI 的 LSP 图来自语言服务器，覆盖服务器支持的全部语言                                                                                                                | low    | 改造：需要时换 tree-sitter 边提取；不急于做                                     |
| R5  | reranker 不是默认路径                                  | `getReranker` 只读配置的 rerank 角色（`retrieval/service.ts:216`），未配置就跳过                                                          | 闭源 IDE 的 Cmd-K 上下文带 Rerank 请求                                                                                                                                    | low    | 保持可选；默认模型不在本轮范围                                                  |

## 2. Agent 执行引擎

**现状**：单轮有硬上限（`loop/turnBudget.ts:44` 默认 128 步）、重复输出与重复工具调用检测、压缩失败熔断（`:75`）；子代理 4 个内置角色；计划模式、后台任务、写屏障都在。

| #   | 差距                                     | TNT 证据                                                                                 | 参考证据                                                                                          | 影响   | 建议                                         |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| E1  | 没有 codemode/脚本编排                   | 工具按回合逐个调用；无脚本执行面                                                         | 外部 npm 发行物 1.19 引入 codemode/延迟工具，1.0 把多工具编排列为能力                             | high   | 自研：需要新子系统，先不进本轮               |
| E2  | 没有持久任务存储                         | `tools/todo.ts` 是会话内列表；无 TaskCreate/Get/Update                                   | 官方 CLI 2.1.310 有 TaskCreate/TaskGet/TaskUpdate/TodoWrite；外部 npm 发行物有 task_* 持久任务    | medium | 改造：Todo 落盘 + 依赖/owner 字段；1-2 天    |
| E3  | 没有 worktree/cron/artifacts/run_command | 工具面 39 个中无这些；`enter_worktree` 等只存在于参考                                    | 外部 npm 发行物 v1 清单；闭源 IDE agent 工具枚举有 TASK/TASK_V2 等                                | medium | 按需自研；worktree 与 review 流程最相关      |
| E4  | 子代理角色 4 vs 参考更多                 | `subagent/builtInAgents.ts` 4 个                                                         | 闭源 IDE 9 种（explore/shell/debug/browser/ci-investigator/bugbot/security-review/fsd/best-of-n） | medium | 改造：补 shell/ci/browser/best-of-n 四个角色 |
| E5  | 终止策略仍缺抢占与重试分类               | `turnBudget` 只有步数与压缩熔断（`:41`、`:75`）；重试在 stream 层有次数，但无 token 抢占 | 参考 turn 引擎把预算、抢占、Retry-After 分类分开                                                  | low    | 改造：先加 token 预算注入，再加分类          |

## 3. 上下文工程

**现状**：系统提示按 section 组装并记录变化（`services/SystemMessageService.ts:64`、`:75`、`:84`）；缓存前缀有 requestHeader 与告警（`stream/requestPreparation.ts`）；压缩有 micro/auto 与缓存守卫；变更文件有一条路径提醒（`agent/changedFiles.ts:16`）。

| #   | 差距                                | TNT 证据                                                                               | 参考证据                                                                                                                     | 影响   | 建议                                                                     |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| C1  | TUI 流式没有 Static 分区            | 全树无 `<Static>`；`ui/utils/transcriptSegments.ts:5` 只有注释提到；切分函数未接渲染层 | gemini-cli `ui/components/MainContent.tsx:411` 用 `<Static>`；`ui/utils/markdownUtilities.ts:93` 有 `findLastSafeSplitPoint` | high   | 改造：先接 `splitTranscriptSegments`，再加 pending buffer 与围栏安全切点 |
| C2  | 系统提示没有分节 merge-patch        | sections 每次整体重建（`SystemMessageService.ts:64-85`），无增量 patch                 | CODE 参考的 world_state 分节更新（转述自前一轮报告，未在本轮重开源码）                                                       | medium | 自研：section 级 diff + 只重发变化段                                     |
| C3  | 上下文预算不注入模型                | grep `tokensLeft/remainingBudget/budgetRemaining` 无命中                               | 参考产品把剩余预算写进尾部提醒                                                                                               | medium | 改造：尾部一行，随回合变化                                               |
| C4  | 变更文件只有路径，没有 diff 片段    | `agent/changedFiles.ts:15` 只列最多 8 个路径，并提示重读                               | 参考把 mtime 变化转成 diff 片段并限三级                                                                                      | medium | 改造：在现有路径提醒后附 hunk，限长度                                    |
| C5  | 没有录制回放层/Windows headless e2e | `e2e/` 无 win32 专项；无录制回放夹具                                                   | 前一轮报告批次 15                                                                                                            | low    | 自研：fixture + CI 矩阵                                                  |

## 4. 工具与能力面

**现状**：39 个内置工具，含本轮新增的 References/CallHierarchy/DocumentSymbol/ImportGraph；工具结果可携带图片（`stream/toolResultMedia.ts`）；参数修复与延迟目录已落地。

| #   | 差距                                      | TNT 证据                                                                                             | 参考证据                                                                                    | 影响   | 建议                                                          |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| T1  | Read 不能看图，也没有视觉回退             | `tools/readFile.ts` 只返回文本；图片管道只服务 Computer                                              | 官方 CLI 的 read_file 给视觉模型看图；外部 npm 发行物有 vision 工具把图交给第二个模型转文字 | high   | 改造：Read 识别图片走 ToolResult；无 image_input 时接视觉模型 |
| T2  | Fetch/WebSearch 能力偏薄                  | Fetch 只有 20k 字符截断（`tools/fetch.ts:13`），无缓存/分页/URL 守卫；WebSearch 无域名过滤/引用      | 外部 npm 发行物 web_fetch 有格式、分页、缓存、超时、URL 守卫；web_search 有域名过滤与引用   | medium | 改造：先加缓存 + 分页，再加域名过滤                           |
| T3  | 后台输出没有统一工具                      | Bash 后台 + CheckBackgroundJob（`tools/checkBackgroundJob.ts`）；无 shell_output/shell_tasks/monitor | 外部 npm 发行物 1.16 把 bash_output/task_output/monitor_events 合成 shell_output            | medium | 改造：一个读取入口，保留旧名兼容                              |
| T4  | 没有 artifacts/run_command/create_diagram | 工具面没有                                                                                           | 外部 npm 发行物 1.86 artifacts、1.0 run_command；闭源 IDE 有 CREATE_DIAGRAM                 | low    | 按需自研                                                      |
| T5  | 没有 codemode                             | 无                                                                                                   | 同 E1                                                                                       | low    | 远期                                                          |

## 5. 闭源发行物对照（补齐）

| 发行物           | 观测                                                                                                                                                                                                                                                                                                                                                                                         | 对 TNT 的含义                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 闭源 IDE         | retrieval 扩展：Native `GrepClient`（crepectl/crepe，ripgrep）+ 特性门 `instant_grep_indexing` + 内存文档上限；索引走服务端 `RepositoryService/FastRepoInitHandshakeV2`、`SyncMerkleSubtreeV2`、`FastUpdateFileV2`，`GetEmbeddings`、`RerankCmdKContext`；agent 工具枚举有 `SEMANTIC_SEARCH`、`SEARCH_SYMBOLS`、`GO_TO_DEFINITION`，**没有** find_references/call_hierarchy/document_symbols | 语义索引与暖 grep 是它的强项；图查询工具反而少于 TNT 现有面             |
| 外部 agent CLI   | 同源工具名：semantic_search、search_symbols、go_to_definition；无 references/call/document                                                                                                                                                                                                                                                                                                   | 与 IDE 一致：语义检索强，图工具弱                                       |
| 官方 CLI 2.1.310 | 单个 `LSP` 工具包含 9 个操作：goToDefinition、findReferences、hover、documentSymbol、workspaceSymbol、goToImplementation、prepareCallHierarchy、incomingCalls、outgoingCalls；另有 ToolSearch、WebFetch、WebSearch、NotebookEdit、EnterPlanMode、AskUserQuestion、TaskCreate/Get/Update                                                                                                      | TNT 的拆分工具已覆盖 7/9；缺 goToDefinition 与 goToImplementation（R1） |
| 外部 npm 发行物  | v1：edit/write 模糊与 stale 守卫、read 看图、web_fetch 缓存/分页、web_search 域名与引用、task_* 持久化、todo 用户编辑保护；1.19 codemode + 延迟工具；1.22 read_multiple_files 并入 read_file；1.16 shell_output 合并三个工具                                                                                                                                                                 | 工具面（T1/T2/T3/T4/E1/E2）的主要参考                                   |

## 6. 结论与优先级

- **P0（本轮之后立刻做）**：R1 两个位置查询工具；C1 Static 接线；T1 Read 看图 + 视觉回退。
- **P1**：E2 持久任务；C2 分节 merge-patch；C3 预算注入；C4 变更文件 diff；T2 Fetch 缓存/分页；T3 统一后台输出。
- **P2**：E1 codemode；E3 worktree/cron/artifacts；E4 子代理角色；C5 录制回放/Windows e2e；R4 导入图 AST 化。

**边界**：闭源侧只做文件级字符串与清单提取，没有执行任何产品；参考侧行号除本轮重新打开的 gemini-cli 两处外，其余为前一轮报告的转述。真实密钥缓存 A/B 因环境未设置 key，未运行。
