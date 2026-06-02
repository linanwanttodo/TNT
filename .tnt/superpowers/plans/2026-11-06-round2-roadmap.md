# TNT 第二轮优化路线图（2026-11-06，v2）

## 0. 方向修正（本轮最重要的变更）

IDE 扩展路线（VS Code/JetBrains 插件作为宿主）已移除。新路线：

- TNT 常驻 **IDE 内置终端**运行（JetBrains IDEA / VS Code / Cursor / Windsurf）。
- 通过 **IDE 自带 MCP** 自动接线，不自己维护扩展。
- 核心收益：IDE 的静态分析（诊断）、文件服务、终端执行能力直接进入 agent。

研究依据（两份侦察报告，2026-11-06）：

| 参考                          | 机制                                                                                                                                                                                                                                                                                                                                                                          | 可借鉴                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code /ide              | 扫 `~/.claude/ide/*.lock`（文件名即端口；内容含 workspaceFolders/pid/ideName/transport/authToken）→ WebSocket MCP（子协议 `mcp`，头 `X-Claude-Code-Ide-Authorization`）→ 注册为固定名 `ide` 的动态 MCP server；工具白名单只有 getDiagnostics/executeCode；诊断靠 CLI 拉取（编辑前 baseline，每轮 diff 新增注入，4000 字符截断）；握手后发 `ide_connected{pid}`                | lockfile 发现协议、workspace 匹配 + 祖先 PID 消歧、诊断 baseline-diff、惰性重连（onclose 清 memo，连续 3 次 terminal error 才 close） |
| Codex /ide                    | 固定 IPC socket（`$CODEX_HOME/ipc/ipc.sock`，u32 LE 帧 + JSON，uid/PEERCRED 校验）→ **每条用户消息拉取一次**活动文件/选区/打开标签，前缀拼进该条消息，`## My request for Codex:` 分隔符保证回放可剥离；核心无诊断通道                                                                                                                                                         | pull-per-turn 注入时机、注入段与用户原文分离、大小控制（选区 40k / tabs 100 条 20k）、失败每会话只警告一次                            |
| JetBrains 内置 MCP（2025.2+） | IDE 内置 webserver（默认端口 64342，可配）暴露 `/mcp`（streamable HTTP）与 `/sse`；工具组：Analysis（get_file_problems 单文件 inspection、lint_files 批量、build_project）、Files（read_file、open_file_in_editor、get_all_open_file_paths）、Search、Execution（get_run_configurations、execute_run_configuration）、Terminal（execute_terminal_command）、VCS（git_status） | 诊断等价物是 `get_file_problems`；连接后先 tools/list 实测真实工具名                                                                  |

## 1. IDE 集成实施计划（新章节，按序）

### IDE-1 发现层（两条通道并行）

1. 通道 A（Claude Code 生态兼容）：扫 `~/.claude/ide/*.lock`，解析字段；校验
   `cwd ∈ workspaceFolders`（NFC 归一化）、进程存活（kill(pid,0)）、TCP 探活 500ms；
   发现前清理 stale lockfile。支持 VS Code/Cursor/Windsurf/带官方插件的 JetBrains。
2. 通道 B（JetBrains 内置 MCP）：探测 `http://127.0.0.1:64342/mcp` 与 `/sse`；
   端口可被 `TNT_IDE_MCP_URL` / `TNT_IDE_PORT` 覆盖。
3. 环境识别：首选 IDE 启动 TNT 时注入的 `TNT_IDE=1` / `TNT_WORKSPACE=<root>`；
   兜底移植 codex terminal-detection 的探测顺序（TERM_PROGRAM 优先，剥离 tmux，
   GHOSTTY/WEZTERM/ITERM/KITTY 等多变量 fallback）。
4. 多 IDE 并存：唯一匹配才自动连（保守策略）；多个进入 `/ide` 手动选择列表。

### IDE-2 连接层

- ws 通道：子协议 `["mcp"]` + `X-Claude-Code-Ide-Authorization: <authToken>`；
- sse / streamable HTTP 通道：直接连；
- 握手成功后发 `ide_connected { pid }` 通知；
- IDE 抽象为固定名 `ide` 的动态 MCP server，接入 TNT 现有 MCP 客户端栈（复用第一轮
  加固的超时/重试/错误分类）。
- 生命周期：memoize + onclose 清缓存惰性重连；连续 3 次 terminal error 才 close；
  用户断开时置空 onclose 防重连；连接超时 35s。

### IDE-3 工具注册与白名单

- 通道 A：只把 `getDiagnostics`、`executeCode` 注册为模型可见工具（`mcp__ide__` 前缀）；
  openFile/openDiff/close_tab 等作为内部 RPC（不暴露给模型）。
- 通道 B：连接后 `tools/list`，按需注册：`get_file_problems`、`lint_files`、
  `read_file`、`open_file_in_editor`、`get_all_open_file_paths`、`git_status`、
  `execute_terminal_command`（谨慎，走权限管线）；其余工具不注册。

### IDE-4 诊断进上下文（核心价值）

1. 数据结构统一到 LSP 风格 `Diagnostic { message, severity(Error/Warning/Info/Hint),
range{start,end}, source?, code? }`；JetBrains 数字 severity 1-4 映射。
2. 时机（结合两家之长）：
   - 每条用户消息：拉当前活动文件诊断（pull-per-turn，Codex 式）；
   - Edit/Write 工具成功后：对被改文件拉诊断，与编辑前 baseline diff 出"新增"，
     以 system-reminder 附件注入（Claude Code 式）；
   - 连接建立时：对活动文件主动 openFile（内部 RPC）+ 拉一次初始诊断。
3. 去重 key `(file, range, message)`；只注入 error/warning；格式
   `- [Error] [Line L:C] message (source)`；总预算 4000 字符 + 中间截断保头尾。
4. 注入段与用户原文分离：消息前缀用 `# Context from my IDE setup:` + 尾部
   分隔符，TUI/WebUI 渲染与回放按分隔符剥离（同时解决第一轮发现的
   hookNotes 污染显示问题的同类隐患）。

### IDE-5 selection / opened-file 附件

- 订阅通道 A 的 `selection_changed` 通知：有选区生成 `ide_selection`（行号+文本），
  仅活动文件生成 `ide_opened_file`；随下一条用户消息发送并去重防重放。
- 通道 B 无推送：per-turn 拉取 `get_all_open_file_paths` + 活动文件。

### IDE-6 验收

- JetBrains IDEA 内置终端实测：自动发现内置 MCP、`get_file_problems` 注入、
  编辑后新增诊断出现在下一轮上下文。
- VS Code/Cursor 内置终端实测：通道 A 自动连接、selection 附件工作。
- 断线重连与 `/ide` 手动选择列表有测试。

## 2. 核心差距实施计划（第一轮 23 项未实施差距的细化）

按依赖与风险排序；每项独立提交，过 tsc + vitest 全量门禁再进入下一项。

### R1. 边流边执行 StreamingToolExecutor — 最高影响项

- 现状证据：`processStreamingResponse` 一次 await 到底（streamChatResponse.ts:228-244），
  toolCalls 直到 "Stream complete" 才导出（processStreamingResponse.ts:270-292）；
  chunkProcessing.ts:163-170 已在参数闭合时增量解析成功但只置 startNotified 死状态。
- 步骤：
  1. chunkProcessing.ts 在参数 JSON 闭合处发出提前调度信号（替换/消费 startNotified）；
  2. toolExecution.ts 增加提前执行通道：仅 shared（并发安全、只读）类工具进入，
     复用现有 planToolCalls/ExecutionGate 与第一轮的权限分层管线；
  3. 写类/独占工具保持流后批量路径不变；
  4. abort 时回收在途提前执行调用（与差距 I 的 canceled 收尾一起做）。
- 验收：集成测试覆盖「流中启动、结果先于流结束返回」；写工具行为不变；全量绿。

### R2. Stop hook 阻断续跑 + 轮间 steering（一次改 turn 循环）

- Stop blocked：消费 fireStop 返回值（chat.ts:830、serve.helpers.ts:101、useChat.ts:455
  三处现全部丢弃）；blocked 时把 stderr 作为反馈注入 user 消息续跑一轮；
  stop_hook_active 置真防自循环（fireHook.ts:267-270 现硬编码 false）。
- steering：turn 循环体内增加轮间检查点，messageQueue 有 pending 输入时以
  system-reminder 随下一个 tool result 搭车注入（复用 todoReminder 通道，
  streamChatResponse.ts:349-364 同款模式）。
- 验收：各自集成测试；自循环防护测试；长 turn 中途注入生效。

### R3. MCP 重连互斥 + tools/list_changed

- 现状：runTool 直接 connectServer 无互斥（MCPService.ts:298-301），并发重连覆盖
  连接导致 stdio 子进程泄漏；reclaiming 窗口内拿到关闭中的 client；无通知监听。
- 步骤：connectPromise 复用（并发调用等同一个 promise）；reclaiming=true 时等待；
  setNotificationHandler 监听 tools/list_changed 后重新 listTools 并刷新工具目录
  （含 annotations→readonly 映射，第一轮已建）。
- 验收：并发重连不泄漏（断言 client 数）；通知后目录更新测试。

### R4. MCP prompts/resources 通道（依赖 R3）

- MCPService 增 listResources/readResource/getPrompt；内建工具 ListMcpResources/
  ReadMcpResource；MCP prompts 映射为可调用命令；resource 块输出占位。
- 验收：三通道各有测试；权限走既有 mcp__ 名字规则。

### R5. hook 协议补全 + 配置热重载

- HookOutput 的 continue:false（终止 turn）/ systemMessage（system reminder 注入）/
  suppressOutput 消费（types.ts:325-329 现为死声明）。
- HookService.reloadConfig 接入 ConfigChange 闭环（现无调用者）；插件 fingerprint
  加 manifest mtime（loader.ts:138-141）；热重载保留 onceKeys，与协议守卫测试一起回归。

### R6. 事件总线合批与断线重放

- eventBus.ts:9-19 裸同步 fan-out：加 100ms delta 合批（块开始事件即时）+ 环形缓冲
  重放（按已有 per-turn seq 锚点续传）；TUI/headless/serve/ACP 四表面回归。

### R7. 小修队列（small，随时插入，文件互不相交）

- Q 索引失败批次不推进 lastUpdated（core/indexing/CodebaseIndexer.ts:651-674）
- R 上下文超限截断可见性（requestPreparation.ts:193-209 接 ContextBudgetTracker）
- G terminal 重试时已流出部分输出的收尾事件（streamChatResponse.ts:307-316）
- I abort 时流中工具调用片段 canceled 收尾（processStreamingResponse.ts:234-243，
  并入 R1 第 4 步）
- V MAX_STEPS 缓存感知收尾：注入总结轮 + toolChoice:none（streamChatResponse.ts:130-132,
  467-470）
- T ensureIndexed 与 FTS 就绪解耦（retrieval/service.ts:167-175）
- W 同步子代理不再无条件 headless（subagent/executor.ts:227；ask 类调用在交互会话
  中可弹窗，async 后台子代理保持自动拒绝）
- S 检索会话感知：排除本轮已读文件；codebaseSearch 增 FULL/OUTLINE/FILENAME 分级
  （tools/codebaseSearch.ts:7-8 去掉 1500 硬切中段）

## 3. 验证面（修正版）

已移除：VS Code/JetBrains 扩展宿主端到端（扩展路线已废弃）。
保留并新增：

1. packages/ 子包：由 vitest 间接覆盖改为显式跑各子包 tsc + vitest。
2. GUI 前端（packages/ 下 gui 侧）：下一轮勘察对象。
3. WebUI：真机浏览器实测一轮完整对话（含工具审批卡、流式、断线重连）。
4. IDE 集成：JetBrains IDEA 内置终端 + 内置 MCP 实测（见 IDE-6）。

## 4. 提交与门禁纪律

- 每项独立提交；tsc --noEmit（core 与 packages/cli）+ 相关 vitest + 全量测试。
- 提交前过 Mimosa 安全门禁：现存高危（SSRF/命令注入/路径穿越）按发现逐项修复，
  新增网络请求代码必须校验 host（仅 http/https，拒绝 localhost/环回/私有/保留地址）。
- 门禁通过后统一推送 origin main。
