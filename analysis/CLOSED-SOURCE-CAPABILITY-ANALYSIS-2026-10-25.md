# 闭源发行物能力分析（2026-10-25，补缺口）

**用途**：补齐 `PRODUCT-GAP-ANALYSIS-2026-10-24.md` §4-4 / §6 中完全未覆盖的“闭源发行物对照”维度。本文只读分析，不执行任何闭源二进制；所有结论带本机文件证据。上一份解码笔记 `test-continue/CURSOR_AGENT.md` 的基线是 2026-10-15，当前 deb 3.26.13 的 bundle 已更新，**byte offset 已漂移**，本文以当前文件重新定位。

**对象（本机）**

```
/usr/share/cursor/resources/app/extensions/cursor-agent-exec/dist/main.js      9.2M  agent 主内核
/usr/share/cursor/resources/app/extensions/cursor-agent-host/dist/main.js     11.8M  编排层
/usr/share/cursor/resources/app/extensions/cursor-retrieval/                         检索/索引
/usr/share/cursor/resources/app/extensions/cursor-browser-automation/                浏览器自动化
/usr/share/cursor/resources/app/extensions/cursor-computer-use/                      计算机操作
```

**方法**：`rg -a` 按字节 offset 定位 + `dd` 截取上下文；不运行、不写盘。以下 offset 是当前版本的值。

---

## 1. 缓存：99.5% 的来源与 TNT 的真实差距

### 1.1 当前 bundle 的原文（offset 4941300–4944400）

```js
function VUe(e){ return Boolean(e.providerOptions?.anthropic?.cacheControl) }
function YUe(e,t=3){
  const r=[]; e.forEach((e,t)=>{ VUe(e)&&r.push(t) });
  if(r.length<=t) return e;
  const n=new Set(r.slice(-t));
  return e.map((e,t)=> VUe(e)&&!n.has(t) ? stripOnlyCacheControl(e) : e)
}
class QUe extends OO {
  constructor(e,t=4){ super(e); this.maxCacheBlocks=t; ... this.applyCacheControlToLast() }
  applyCacheControlToLast(){
    const e=this.messages.length-1;
    this.messages[e]=withCacheControl(this.messages[e], {type:"ephemeral"});
    this.messages=YUe(this.messages,this.maxCacheBlocks);
  }
  appendMessages(e){ ...this.messages.push(...t); this.applyCacheControlToLast() }
}
```

结论：

1. **消息容器默认 `maxCacheBlocks=4`**；每次 `appendMessages` 只在**最后一条消息**放一个新断点，然后保留最近 N 个消息断点，更老的只删 `providerOptions.anthropic.cacheControl` 一个 key（`thinking` 等其它选项保留）。
2. 断点是 `{type:"ephemeral"}`（5 分钟 TTL），与 Anthropic 默认一致。
3. 这印证了旧笔记的 `maxCacheBlocks=4` 结论，并给出了当前版本的准确位置与 helper 默认值（`YUe` 自身默认 3，容器显式传 4）。

### 1.2 用量口径（同一 bundle，offset 4942200 附近）

```js
inputTokens: e.promptTokens + n + s; // n=cacheRead, s=cacheCreation
outputTokens: e.completionTokens;
cacheReadTokens: n;
cacheWriteTokens: s;
```

即 `inputTokens` 是**包含缓存读/写的全部计费 prompt**。TNT 的 `reportedInput = fullUsage.prompt_tokens`（归一后同样含缓存桶），口径一致；`cacheHitRate = cacheRead / reportedInput` 与 dsh 的 `cacheRead / (input + cacheRead + cacheWrite)` 同义。

旧笔记还记录：压缩调用有独立的 `anthropic_compaction.input_token / output_token / cache_read_token` 遥测，说明压缩本身吃缓存且单独统计。

### 1.3 TNT 现状（已核验）

- 断点预算：`ANTHROPIC_BREAKPOINTS_KEPT = 2`，保留**最新消息 + 稳定头**（最后一个 tool，没有 tool 时最后一个 system block）；Anthropic 单请求上限 4，超过是 400，不是静默忽略（`openai-adapters/src/apis/cacheControl.ts:110-190`）。
- 发送前清洗：reasoning 块上的断点删除、无 signature 的 thinking 块剔除（`sanitizeReasoningBlocks`），与 Cursor 的清洗一致。
- 前缀三态：`cache/prefixState.ts` 的 full / passthrough / invalidated + `requestHeader` 规范化 + 断点原因遥测，与 Cursor 的 root prompt 三态同形。
- 压缩复用：`compaction/prefixPreservation.ts` 把压缩指令作为**最后一条 user 消息**追加，完整重放 system + tools + history；`summarizeWithEngine` 走同一个 `streamChatResponse`。**这不是缺口**——dsh 的“压缩摘要复用热前缀”机制 TNT 已经有，且 `prefixPreservation.test.ts` 有断言。
- 压缩后基线：`usageTelemetry` 现在对 `isCompacting` 请求重置 break 基线（本次 P1-1 落地）。
- 命中率守卫：`cache/cacheHitGuard.ts` 尾部 3 轮地板 0.95，`CONTINUE_CLI_CACHE_HIT_FLOOR` 可覆盖；`cache/cacheGuard.e2e.test.ts` 验证稳定前缀、真实失效、跨 reload 三个方向。

### 1.4 差距判断（不要过度归因）

| 维度              | Cursor IDE（本机 bundle）                                                  | TNT                                              | 判断                                 |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| 消息断点窗口      | 最多 4 个消息断点，滑动保留最近 N；每轮只在最后一条消息加新断点            | 总量 2：最新 + 稳定头；按写/读成本取舍           | **唯一明确差异**                     |
| system/tools 断点 | body 转换器会给 system 块带 `cacheControl`；tools 是否带未在截取窗口内确认 | 稳定头固定落在最后一个 tool（或最后一个 system） | 语义相近，计数方式不同               |
| 清洗              | 只删 `cacheControl` key；reasoning 断点无效                                | 同                                               | 已对齐                               |
| 压缩复用          | 压缩有独立缓存遥测；分段布局按厂商 4 种                                    | 前缀复用已做；单一压缩布局                       | 复用已对齐，**布局分层是另一个问题** |
| 计费口径          | input = prompt + read + write                                              | 同                                               | 已对齐                               |
| 99.5% 本身        | Cursor 自有后端观测值                                                      | 受控 e2e 已过 95% 地板；真实密钥未测             | **不可直接换算**                     |

**结论**：Cursor 的 99.5% 不能简单归因于“4 断点”。它的后端、TTL、路由与 TNT 直连 Anthropic/DeepSeek 不同；能确定的客户端差异只有**消息断点滑动窗口**。正确做法是做一次真实密钥 A/B，而不是直接改默认值：

- 方案 A（现状）：总量 2 = 稳定头 + 最新。
- 方案 B：总量 3 = 稳定头 + 最新 + 倒数第二条消息。
- 方案 C：总量 4 = 稳定头 + 最近 3 条消息断点（最接近 Cursor 的消息窗口）。
- 观测：连续 ≥10 轮工具循环的 `cacheRead / prompt_tokens` 尾部均值、cacheWrite 成本、每轮前缀是否 passthrough；用新的 `cacheHitGuard`/e2e 记录。
- 判定：只在“尾部命中率不低于 A 且总成本不升”时切换。Anthropic 的 4 上限与写入 1.25x/读取 0.1x 的成本模型必须一起算。

---

## 2. 工具面 delta

从 `cursor-agent-exec/dist/main.js` 的字符串与工具注册表中提取到的工具名：

`read_file`（按模型版本映射 Read / ReadFile / read_file）、`run_terminal_cmd`、`apply_patch`、`search_replace`、`MultiEdit`/`StrReplace`/`Write`、`search`、`grep`、`list_dir`、`delete_file`、`web_search`、`read_lints`、`todo_write`、`create_plan`、`task`、`browser`、`computer_use`、`edit_notebook`、skills、MCP。

TNT 的 30 个内建工具（`tools/allBuiltIns.ts`）：ApplyPatch、AskQuestion、CheckBackgroundJob、CodebaseSearch、Completion、Diagnostics、Edit、Exit、Fetch、FindSymbol、Glob、EnterPlanMode、ExitPlanMode、Hover、List、MultiEdit、Read、ReportFailure、Bash、Search、Status、Todo、ToolSearch、Subagent、ListSubagents、Skills、UploadArtifact、Diff、Checklist、Write。

| 能力              | Cursor IDE                                                                                                | TNT                                                                                                                                                                           | 差距                   |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 文件读/写/改/多改 | 有                                                                                                        | 有（Read/Write/Edit/MultiEdit/ApplyPatch）                                                                                                                                    | 已对齐                 |
| 终端              | `run_terminal_cmd`                                                                                        | Bash（超时/后台/截断）                                                                                                                                                        | 已对齐                 |
| 搜索/列目录       | `search`/`grep`/`list_dir`                                                                                | Search/Glob/List/CodebaseSearch                                                                                                                                               | 已对齐                 |
| **lint 反馈**     | `read_lints`                                                                                              | **已补**：Write/Edit/MultiEdit/ApplyPatch 成功后自动跑 Diagnostics（`stream/postEditDiagnostics.ts`），失败/超时不阻断编辑                                                    | 已对齐                 |
| 删除文件          | `delete_file`                                                                                             | **已补**：`Delete`，移入全局 trash 并返回恢复路径；拒绝 root/.git/越界                                                                                                        | 已对齐                 |
| 网页搜索          | `web_search`                                                                                              | **已补**：`WebSearch`，可配 JSON 端点（URL+KEY），否则公共 HTML 页面                                                                                                          | 已对齐                 |
| 浏览器/计算机操作 | `browser` + `computer_use`（独立扩展）                                                                    | **Browser 已补**（CDP，需用户开远程调试端口）；**Computer 已补**：截图/指针/点击/拖拽/输入/按键/滚轮/等待，截图直接回注给模型；Linux 完整、macOS 指针与文本、Windows 暂不支持 | 已对齐（Windows 除外） |
| Notebook          | `edit_notebook`                                                                                           | **已补**：`NotebookEdit`，按 id/index 替换/插入/删除 cell                                                                                                                     | 已对齐                 |
| 计划/Todo         | `create_plan`/`todo_write`                                                                                | EnterPlanMode/Todo/Checklist                                                                                                                                                  | 已对齐                 |
| 子代理            | `task` + 9 种内置角色（explore/shell/debug/browser/ci-investigator/bugbot/security-review/fsd/best-of-n） | **已补** 4 个内置角色：verification / explore / debug / security-review（`subagent/builtInAgents.ts`）；其余仍可配置                                                          | 部分对齐               |
| LSP 符号          | 通过检索后端，不暴露独立 LSP 工具                                                                         | FindSymbol/Hover/Completion/Diagnostics 四个显式工具                                                                                                                          | TNT 反而更显式         |
| MCP / Skills      | 有                                                                                                        | 有                                                                                                                                                                            | 已对齐                 |

---

## 3. 检索与代码库理解

Cursor `cursor-retrieval` 的字符串统计（`dist/*.js`）：`index` 394、`Symbol` 148、`Merkle` 42、`Embedding` 24、`Rerank` 19、`Semantic` 16、`Treesitter` 10。即：向量/嵌入 + **rerank** + **Merkle 增量索引** + tree-sitter 符号。

TNT 现状：

- `retrieval/service.ts:156`：`search()` = 全文检索 + LanceDB 向量检索，`mergeHits` 按 FTS 优先合并；**没有调用 reranker**。
- 但 core 已经定义了 reranker 接口与配置：`core/config/types.ts:144`（`rerank(query, chunks)`）、`:1165`（`RerankerDescription`）。**能力在 SDK 里，CLI 没有消费**。
- **Merkle 结论核验（2026-10-25 更正）**：core 已经用内容哈希 + mtime 做增量索引。`core/indexing/refreshIndex.ts` 的 `tag_catalog` 按 `(dir, branch, artifactId, path)` 存 `cacheKey`；只有 `lastUpdated < lastModified` 时才重算 `calculateHash(fileContents)`，内容相同就只更新 `lastUpdated`，内容变了才换版本。`writeRefresh.ts` 的单文件 refresh 是这条增量链的入口。Cursor 的 Merkle 树是其索引后端的实现结构，**不是 TNT 的实质缺口**，不重复建设。
- tree-sitter 分块在 core 索引里已有；LSP 工具显式可用。

**最高性价比缺口已补**：`RetrievalService.search` 在 FTS + 向量合并后调用配置好的 reranker（无配置不调用，抛错/分数数不符保持原序），`retrieval/rerankHits.test.ts` 覆盖重排、异常与回退。这比 Merkle 改造小得多，直接提升“代码库理解”的排序质量。

---

## 4. 引擎与上下文（已对齐项，避免重复劳动）

TNT 已具备、无需再做的 Cursor 机制：

- 有界循环：`loop/turnBudget.ts` 默认 `maxSteps: 128`（Cursor CLI agent 也是 128；IDE agent 512）。
- 流式周期检测、按工具粒度失败计数、递减收益熔断。
- 写屏障：`tools/specs/gate.ts` 的 `ExecutionGate`，按文件 key 串行、2s 超时放行、`completed/timeout/aborted` 归因——与 Cursor 的 write barrier 同形。
- readonly 执行期约束：权限层 + plan 模式；子代理用 `restriction: "no-writes"` + `deniedTools`。
- 前缀三态、reasoning 清洗、压缩前缀复用、压缩缓存遥测。

仍存的非缓存差异：

1. **压缩分段布局**：Cursor 按厂商准备 4 种 leading/trailing 布局；TNT 只有一种。影响压缩后的上下文质量，不影响缓存复用。
2. **root prompt 序列化 blob**：Cursor 为子代理状态提供 blob refs；TNT 用 `requestHeader` 规范化覆盖三态，但没有 blob 层。属大规模子代理场景的优化，当前不急。
3. **内置子代理角色**：1 vs 9，见 §2。
4. **IDE 512 步 vs CLI 128 步**：TNT 的 `maxSteps` 可由参数覆盖，默认值与 CLI 场景一致，不算缺口。

---

## 5. 本轮已落地（2026-10-25）

| 项            | 落点                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 检索 reranker | `retrieval/service.ts`：FTS+向量合并后调用配置好的 reranker；无配置/异常/分数数不符回退原序。`retrieval/rerankHits.test.ts`。                                                                                                                                                        |
| 编辑后诊断    | `stream/postEditDiagnostics.ts` + `stream/toolDispatch.ts`：Write/Edit/MultiEdit/ApplyPatch 成功后对最多 3 个文件跑 LSP，≤20 条、单行截断；失败不阻断。                                                                                                                              |
| 内置子代理    | `subagent/builtInAgents.ts`：verification / explore / debug / security-review，各自 restriction + deniedTools。                                                                                                                                                                      |
| Delete        | `tools/deleteFile.ts`：全局 trash 可恢复；拒绝 root/.git/越界；目录需 recursive。                                                                                                                                                                                                    |
| WebSearch     | `tools/webSearch.ts`：可配 JSON 端点（`CONTINUE_CLI_WEB_SEARCH_URL`/`KEY`），否则公共 HTML 页面；条数上限 10。                                                                                                                                                                       |
| NotebookEdit  | `tools/notebookEdit.ts`：按 cell id/index 替换/插入/删除；代码 cell 清 outputs/execution_count。                                                                                                                                                                                     |
| Browser       | `tools/browser.ts` + `tools/browserClient.ts`：CDP，navigate/snapshot/click/type/screenshot；需用户开远程调试端口。                                                                                                                                                                  |
| 断点预算      | `openai-adapters/src/apis/cacheControl.ts`：2/3/4 可切换（`CONTINUE_CLI_ANTHROPIC_BREAKPOINTS`），默认仍 2；3/4 保留稳定头 + 中间消息断点。                                                                                                                                          |
| Merkle        | 核验为等价能力（`tag_catalog + cacheKey + lastModified`），不做。                                                                                                                                                                                                                    |
| Computer      | `tools/computer.ts` + `tools/computerDriver.ts`：screenshot / cursor_position / move / click / drag / type / keypress / scroll / wait；Linux `xdotool` + `grim`/`import`，macOS `cliclick`+System Events，Windows 明确报不支持；截图经工具结果图片管道回注，坐标按最后截图边界校验。 |

## 5.1 多厂商缓存策略（本轮）

按厂商归类，不再只对单一模型调参。统一开关 `CONTINUE_CLI_CACHE_RETENTION=short|long|none`（默认 `short`），策略表在 `openai-adapters/src/apis/cachePolicy.ts`。

| 厂商                                | 客户端动作                                                               | 短 TTL | 长 TTL                         | 断点/写点                          |
| ----------------------------------- | ------------------------------------------------------------------------ | ------ | ------------------------------ | ---------------------------------- |
| Anthropic 直连                      | 显式断点 + `ttl`                                                         | 5m     | 1h（`ttl:"1h"`，无需 beta 头） | 4，默认保留 2                      |
| OpenAI Responses（GPT-5.6+）        | `prompt_cache_options:{mode:"explicit",ttl}` + `prompt_cache_breakpoint` | 30m    | 12h                            | 4，实际放稳定头 + 最新消息 2 个    |
| OpenAI 旧模型                       | 无需动作（自动前缀缓存）                                                 | 30m    | 同短                           | 0                                  |
| Bedrock                             | `cachePoint:{type:"default",ttl}`                                        | 5m     | 1h（仅 Claude 4.5+）           | 4，实际 system/tools/最新消息 3 个 |
| Moonshot K3+                        | `prompt_cache_options:{mode:"implicit",ttl}`                             | 5m     | 1h                             | 0（隐式）                          |
| OpenRouter 的 Anthropic 路由        | 透传 `cache_control`，长模式加 `ttl`                                     | 5m     | 1h                             | 2                                  |
| DeepSeek / Gemini / zAI / DashScope | 保持前缀稳定（隐式）                                                     | 5m     | DeepSeek 24h                   | 0                                  |

配套改动：

- `compaction/microCompact.ts` 的裁剪阈值直接取策略表的 `ttlMs`；无缓存的本地厂商（ollama/llama.cpp/lmstudio/vllm 等）不再为缓存裁剪历史（阈值视为无穷）。
- `CheckBackgroundJob` 新增 `block_until_ms`（上限 120s）：等待超时仍未结束时，结果尾部给出该厂商 TTL 提示，避免盲目再等把热前缀等凉。
- `CONTINUE_CLI_CACHE_RETENTION=none` 同时关闭请求侧断点/选项与微压缩的裁剪动机。

## 5.2 建议的下一步（按性价比）

| 优先级 | 动作                                                               | 落点                                                                                                                               | 量级        | 依据  |
| ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----- |
| P1     | 断点窗口真实密钥 A/B（2 vs 3 vs 4，总预算含稳定头）                | **预算切换已实现**：`openai-adapters/src/apis/cacheControl.ts` + `CONTINUE_CLI_ANTHROPIC_BREAKPOINTS`，默认仍 2；真实密钥 A/B 待跑 | 1 天 + 真钥 | §1.4  |
| P1     | 让 `RetrievalService.search` 消费已配置的 reranker（无配置不调用） | **已完成**：`retrieval/service.ts` + `rerankHits.test.ts`                                                                          | 半天        | §3    |
| P2     | 编辑后自动诊断闭环（ReadLints 等价物）                             | **已完成**：`stream/postEditDiagnostics.ts` + 工具结果注入                                                                         | 1-2 天      | §2    |
| P2     | 内置子代理角色：explore / debug / security-review                  | **已完成**：`subagent/builtInAgents.ts`（4 个角色）                                                                                | 1-2 天      | §2    |
| P3     | web_search 工具（若产品范围包含）                                  | **已完成**：`tools/webSearch.ts`（JSON 端点 + 公共 HTML）                                                                          | 2-3 天      | §2    |
| P3     | 删除工具 + 撤销（替代裸 `rm`）                                     | **已完成**：`tools/deleteFile.ts`（trash 恢复路径；5s toast 未做）                                                                 | 2 天        | §2    |
| P3     | 压缩分段布局、root prompt blob（Merkle 已核验为等价能力，不做）    | 未做                                                                                                                               | 周级        | §3/§4 |
| —      | browser / computer-use                                             | **Browser 已完成**（CDP）；**Computer 已完成**（视觉截图回注 + 平台驱动；Windows 暂不支持）                                        | 大          | §2    |

不建议现在做的：直接改 `ANTHROPIC_BREAKPOINTS_KEPT` 的默认值；预算开关已经能测，但没有真实密钥的命中率数字支撑时，改默认值只会把成本模型换成猜测。

---

## 6. 证据边界

- 本文的 Cursor 侧 offset 是当前 deb 3.26.13 的 bundle；旧笔记 `CURSOR_AGENT.md` 的 2026-10-15 offset 已漂移，不要混用。
- bundle 已压缩，单字母符号的语义由上下文与字符串推断；**Cursor 后端是否接受超过 4 个断点、是否在服务端做窗口驱逐，无法从客户端文件确认**。
- 未执行任何 Cursor 二进制；未使用真实 API key；99.5% 是用户观测值，本文不把它当作 TNT 可达的承诺。
- TNT 侧结论均来自当前仓库源码与已运行的测试；`prefixPreservation`、`ExecutionGate`、`prefixState` 是“已有、不要再建”的项。
- Merkle 一项在本轮复核后更正：TNT 的 `tag_catalog + cacheKey + lastModified` 已经承担了“只重算变化的文件”的职责；分布式 Merkle 树只会改变索引的传输/校验形状，不改变单机 CLI 的增量能力。
