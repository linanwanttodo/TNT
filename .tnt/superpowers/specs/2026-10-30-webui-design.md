# TNT WebUI — 设计文档

日期：2026-10-30
状态：待批准
参考：`.tnt/superpowers/specs/` 目录约定

## 意图与动机

TNT 目前只有终端界面（Ink TUI）。用户希望在浏览器里看到并操控同一个会话：
聊天流实时滚动、工具调用与输出、权限审批、排队消息 —— 不打开终端也能盯进度、
点批准、补一句话。这同时是后续 `/mobile`（手机连接）的地基：手机浏览器直接开
webui 就是最简单的移动入口。

界面取自 DSH（DeepSeek Harness，MIT 协议）的 Web 前端视图层：用户明确选择
"只要界面，连接自己做"。DSH 的界面成熟好看，视图组件（聊天流、审批卡片、设置、
智能体团队面板）剥离框架耦合后可以直接搬；数据层 TNT 自己写。

## 目标 / 非目标 / 反目标

**目标**

1. TUI 内输入 `/webui` → 本地起 HTTP 服务托管网页 → 自动打开浏览器 → 浏览器里
   实时看到当前会话（历史 + 流式输出 + 工具调用 + 审批请求），可以发消息、
   审批、点停止按钮直接截断；`/webui stop` 停止。
2. 终端直接 `tnt webui` → 独立进程起同样的网页（同核心、同 API）；
   `--timeout 0` 长驻不退出，配合服务器部署可 7×24 运行，`--resume` 恢复上次
   会话 —— 长驻期间可以持续跑任务（自进化的最小形态）。
3. 界面观感 = DSH Web UI（视觉组件原样搬运，品牌色换成 TNT）。
4. 默认安全：仅绑定 loopback、token 门卫、URL `#token=...`
   换取 HttpOnly cookie。

**非目标（本期不做）**

- 手机隧道 / 配对二维码 / Cloudflare Tunnel（`/mobile` 期再做；手机浏览器直接
  开 webui 是最简单的移动入口）。
- **局域网绑定（`/webui lan`）**：v1 仅 loopback；外部访问等 `/mobile` 期与
  TLS 一起做。
- 文件上传、语音输入、插件管理、技能市场等 DSH 有而 TNT 没有的功能。
- 多会话管理界面：`/webui`（TUI 内）只显示当前会话；`tnt webui` 独立进程
  也只挂一个会话（`--resume` 可选），会话切换回 TUI 做。
- 新的调度/自进化框架（沿用现有 goal、subagent、计划任务能力）。

**反目标（视为失败）**

- 把 DSH 的 277 包连接闭包搬进 TNT（体积、协议、维护全错）。
- webui 起一个独立于 TUI 会话的"第二个引擎"（必须同一个会话、同一个核心）。
- 无认证的局域网暴露。

## 约束

- TNT monorepo：pnpm workspace；webui 前端是**独立仓库**
  （用户决定：`tnt-webui`，单独 repo，因为它是一个命令、一个独立功能，
  只通过 HTTP 与 TNT 通信）。CLI 通过 npm 依赖引用它。
- 界面组件从 DSH 源码（github.com/deepseek-ai/deepseek-harness，MIT）摘取，
  LICENSE 与 THIRD-PARTY-NOTICES 保留其版权声明。
- TNT 守卫文化：新命令要进 slash-commands 双语文档、namingLedger 不得增长
  "Continue" 计数、branding 白名单检查等。
- 产物体积：前端构建后整体 < 3MB（DSH 原包 5.4MB，剥离未用功能后应显著缩小）。

## 方案（已与用户对齐的部分）

**方案 B 瘦身版 —— 搬界面、自写连接**（用户选定）

考虑过并放弃的：

- **A. 自写前端**：数据层最省，但用户明确要 DSH 的界面观感，自写达不到。
- **B-全量. 整个 dsh-web-frontend 接 TNT**：277 包闭包、cordis 框架、DSH
  Remote 协议全要适配，体积与维护成本不可接受。
- **B-瘦身（选定）. 只搬视图层**：`ui-primitives` + `ui-theme` + `ui-chat`/
  `ui-conversation`/`ui-approval`/`ui-settings`/`ui-agent-team` 的视图组件
  （.tsx + CSS Modules），把组件 import 的 DSH 类型改为 TNT 侧的轻量类型；
  连接层自写一个 adapter（fetch + SSE → 组件的 store 形状）。

**形态 —— 两个入口**（用户指定）

- ① TUI 内 `/webui` 斜杠命令（像 AtomCode）：当前进程内起一个 express 路由组
  （复用 `serve.helpers.ts` 已有的事件流/审批通道），托管静态文件，打印带 token 的
  URL 并打开浏览器。`/webui stop` 停止。
- ② `tnt webui` CLI 子命令（像 `dsh web`）：独立进程，初始化服务核心后起 server
  —— 与 `tnt serve` 同构但托管网页、token 认证、默认长驻倾向
  （`--timeout 0` 关闭不活跃退出）。服务器部署/24 小时运行用这个入口：
  tmux 或 systemd 拉起 `tnt webui --timeout 0 --host 0.0.0.0`，反代加 TLS。
  `--resume` 恢复上次会话。

## 架构

```
TUI 进程 (Ink)
  └─ /webui 命令 (src/ui/commands/handlers/webui.ts)
       └─ WebUiService (src/services/WebUiService.ts)
            ├─ express 路由组，挂在 TUI 进程内的独立 http server 上
            ├─ GET  /            → 静态文件（tnt-webui dist）
            ├─ GET  /state       → 会话快照（复用 getCompleteStateSnapshot）
            ├─ GET  /events      → SSE（复用 serve.helpers 的引擎事件流）
            ├─ POST /message     → messageQueue.enqueueMessage
            ├─ POST /permission  → interactionBroker approve/reject
            ├─ POST /pause       → 中断当前轮次（abort 信号）
            ├─ POST /exit        → 结束会话
            └─ token 门卫：除静态资源与 bootstrap 外，校验 cookie/bearer

引擎仲裁（无轮次锁，对齐 AtomCode AgentHandle 模式）
  messageQueue + 轮次消化收进进程内共享的引擎服务：
  TUI 与 WebUiService 都只投递消息、都订 eventBus —— 谁先到谁跑，
  事件流对两个表面同源，停止 = abort 信号，任何表面可发。

独立长驻进程 (tnt webui)
  与 serve 同构的入口：初始化服务核心 → 起 WebUiService（同一路由组）
  → --timeout 0 长驻 / --resume 恢复会话 / --host 指定绑定。
  tnt webui stop 通过 pid/心跳文件停掉长驻实例。
```

前端（独立 repo `tnt-webui`，vite + React）：

```
tnt-webui/
  src/
    api/        自写连接层：SSE 订阅、/state 轮询降级、消息发送、审批
    stores/     轻量 store（zustand），形状对齐 DSH UI 组件的 props 契约
    ui/         从 DSH 摘取的视图组件（primitives/theme/chat/approval/
                settings/agent-team），import 改指 TNT 类型
    types/      TNT 侧轻量类型（对齐 core 的 ChatHistoryItem、
               ActivePermissionRequest 等）
  LICENSE / THIRD_PARTY_NOTICES.md（DSH 的 MIT 版权声明）
```

## 关键决策（做过的决定，标注归属）

| 决策                           | 内容                                                                                                                                                                                                                                                                          | 归属                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 谁跑浏览器的轮次（审阅问题 1） | **引擎仲裁，无轮次锁**（对齐 AtomCode 的 AgentHandle 模式）：把"消化 messageQueue + 跑轮次"提为进程内共享的引擎服务，TUI 与 WebUiService 都只往队列投递、都订事件总线，谁先到谁跑，事件流对两个表面同源。TUI 回合结束消化队列的现有逻辑改为调这个共享服务。不引入双消费者竞争 | 用户指出 AtomCode 就是同步的，机制照它                 |
| `/webui lan`（审阅问题 2）     | **v1 砍掉，只做 loopback**；局域网/服务器外部访问等 `/mobile` 期与 TLS 隧道一起做                                                                                                                                                                                             | 用户选定 a                                             |
| 停止语义（审阅问题 3）         | **与 CLI 一致的直接截断**：网页输入框旁的停止按钮（DSH 同款）→ POST /pause → 引擎服务中断当前轮次（abort 信号），TUI 与网页同时看到 turn.interrupted 事件。任何表面都能停                                                                                                     | 用户指定（对齐 DSH 的停止按钮）                        |
| 入口（两个都有）               | ① TUI 内 `/webui` 斜杠命令：连**当前会话**；② `tnt webui` CLI 子命令：独立进程起 server（无头或带 UI），可 `--timeout 0` 长驻                                                                                                                                                 | 用户指定（对齐 AtomCode 的斜杠 + Reasonix 的独立启动） |
| 端口                           | **47610** 起步（不常用高位端口，避免与 8787/3000/8080 类常见端口冲突），占用自动 +1，最多探 100 个；`--port` 可指定。**复用警告**：serve.helpers 的绑定失败 `process.exit(1)` 路径绝不能进 webui —— 必须捕获 EADDRINUSE 顺延                                                  | 用户要求不常用端口；exit 隐患审阅发现                  |
| 认证                           | 每次启动生成随机 token；URL `#token=` 片段经 bootstrap 页换 HttpOnly cookie；无 token 只能看空白页。`tnt webui` 长驻模式 token 持久化到 `~/.tnt/webui-token`（0600），重启不变                                                                                                | 我的默认（对齐 Reasonix + AtomCode）                   |
| 绑定                           | v1 仅 127.0.0.1；服务器部署用 `--host 0.0.0.0` + 反代 TLS（`/mobile` 期一起收紧）                                                                                                                                                                                             | 用户选定 v1 砍 lan                                     |
| 浏览器                         | 自动 open；`--no-open` / `/webui --no-open` 只打印 URL                                                                                                                                                                                                                        | 我的默认                                               |
| 服务器长驻                     | `tnt webui --timeout 0` 关闭不活跃退出（serve 默认 300s 无活动即关）；配合 tmux/systemd 可 7×24 运行；会话持久化本就落盘，重启 `tnt webui --resume` 恢复上次会话                                                                                                              | 用户要求"24 小时运行"                                  |
| 自进化                         | "自进化" = 长驻 server 里持续跑任务（subagent、goal、计划任务）不受终端关闭影响；本期只保证进程长驻 + 会话恢复，调度类自进化沿用现有 goal/计划任务能力，不新做                                                                                                                | 用户提到自进化，最小解释落地                           |
| DSH 连接机制参考               | DSH/AtomCode 前端通过"命令通道 + 事件流"驱动 store；TNT adapter 等价实现：SSE（已有 /events）承载事件流 + POST 承载命令，store 形状对齐 DSH UI 组件的 props 契约；若 SSE 重连/背压不够用，允许加 `/ws` WebSocket 通道，事件协议不变                                           | 用户允许参考                                           |
| i18n                           | 前端界面中英双语（跟随 TNT 的 locale 约定，/state 下发）；`cmd.webui` 双语 key 与双语文档行同 commit 补齐（slashCommandsDoc 双向守卫）                                                                                                                                        | 我的默认；文档义务审阅确认                             |
| 构建                           | tnt-webui 独立 repo，GitHub Actions 构建 npm 包；CLI 以 optionalDependencies 引用 dist；缺包时返回安装指引页                                                                                                                                                                  | 用户选定独立 repo                                      |
| 命令解析                       | `/webui` 参数按现有 handleMcp/handleThink 风格手写 token 解析（stop / --no-open / --port=value），不引入 flag 库；v1 不加状态行，URL 打印在输出里                                                                                                                             | 审阅默认，采纳                                         |
| 生命周期                       | `/webui stop`（TUI 内停）+ `tnt webui stop`（停后台长驻实例，pid/心跳文件定位）；TUI 退出时自动关闭自己的 server                                                                                                                                                              | 我的默认                                               |

## 交给实现者的部分（留给 builder）

- 从 DSH 摘取视图组件的具体清单与每个组件的类型断接点（对照
  /tmp/dsh-src/packages/client，逐包盘点，先 chat 流 + 审批卡，
  settings 与 agent-team 面板其次）。
- SSE 事件 → UI store 的映射细节（对齐 TNT 引擎事件契约，事件流在
  `serve.helpers.ts` 的 `registerSseEventRoute`）。
- 静态资源解析：CLI 运行时定位 tnt-webui dist（node_modules 或本地构建产物），
  缺包时 `/webui` 给出安装指引。
- 测试切分：CLI 侧（路由、token、端口探测、命令注册）用 vitest；
  前端侧（adapter 翻译、组件渲染）用 vitest + testing-library，放 tnt-webui repo。

## 验收

1. TUI 输入 `/webui`：终端打印 URL 并打开浏览器，页面 3 秒内可见聊天流。
2. 浏览器发消息 → TUI 与网页同时看到回答流式输出（TUI 闲着时浏览器消息立即开跑）。
3. 工具调用触发审批 → 网页出现审批卡，点击允许 → TUI 继续执行。
4. 网页点停止按钮（或 CLI 内 esc）→ 轮次直接截断，两个表面都出现中断提示。
5. 无 token 直接访问 → 空白/拒绝页；带 token 访问 → 正常。
6. `/webui stop` 后端口释放，页面断线提示。
7. `tnt webui` 独立启动：浏览器可连；`--timeout 0` 挂机 24 小时不退出；
   `--resume` 恢复上次会话；`tnt webui stop` 停掉长驻实例。
8. 端口 47610 被占时自动顺延到 47611+，终端打印实际端口；绑定失败绝不
   `process.exit`（TUI 进程必须存活）。
9. TNT 守卫全绿（slashCommandsDoc 双语、namingLedger、branding、prettier）。
