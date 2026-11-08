# TNT WebUI —— 全面替换为 ZCode Desktop 界面

日期：2026-11-08
状态：待批准
取代：`2026-10-30-webui-design.md`（原 DSH 瘦身方案，已实现但界面观感未达预期，本文档全量替换其前端部分）

## 意图与动机

现有 webui 前端（`packages/cli/webui`，265 个源文件）是按原 DSH 瘦身方案自写的界面，
用户判定其观感不合格，要求**整体删除**，换为 ZCode Desktop 的界面 —— 原模原样搬运，
不做视觉改动，只做接线。ZCode 源码位于
`/home/lin/All_projects/GithubProjects/test-continue/ZCode`（本地私仓，非公开发布包）。

## 侦察结论（方案成立与否的关键事实）

1. **ZCode UI 的规模与耦合**：`packages/ui` 约 1982 个 ts 文件（208 个在 src 顶层），
   其中 **225 个文件直接 import `@zcode/services`** 的约 58 个服务接口
   （`IZCodeAgentService`、`IFileService`、`IGitService`、`ISettingService`……），
   全部通过 `IServiceAccessor` 依赖注入取得。`packages/desktop/src/renderer` 另有
   379 个文件，强依赖 Electron MessagePort 与桌面平台桥。
2. **改写 UI 数据层不可行**：把 225 个文件的服务调用改写为 TNT 现有 REST/SSE 契约
   等于重写整个 UI，"原样保留观感"无法保证。此路排除。
3. **ZCode 自带浏览器接入路径（选定路线的根据）**：`packages/web`（54 个文件）通过
   `connectViaWebSocket`（`@zcode/client`，13 文件）→ `@zcode/rpc` 的
   `SocketProtocol`/`ChannelServer` 连接服务端；服务端实现是
   `packages/server/src/http.ts`（482 行，Hono + `@hono/node-ws` WebSocket +
   `ServiceCollection.exposeOnChannelServer`）。UI 不关心对端是 Electron 还是
   WebSocket —— 服务接口实现即可。这是唯一能原样保留 UI 的接线方式。
4. **服务接口面**：`IZCodeAgentService` 一个接口约 155 个方法（会话、任务、流订阅、
   权限、MCP、插件、工作流……），是最大的单项工作量。
5. **外部依赖规模**：`ui` 73 个外部依赖（radix、lexical、xterm、pdfjs、recharts、
   streamdown 等，多数与现有 webui 重合或更重），`services` 18 个，`shared` 5 个，
   `rpc` 2 个，`client` 1 个。其中 `services` 含原生编译依赖 `node-pty`
   （终端服务）与重包（`@larksuiteoapi/node-sdk`、`@agentclientprotocol/sdk`）；
   用户已确认接受 node-pty（见关键决策表）。
6. **搬运闭包大于 6 包（审查修正）**：`packages/ui` 与 `packages/services` 还引用
   `@zcode/provider`（58 处 import；纯 TS，仅依赖 zod/shared/model-option-map，
   **不依赖 Electron**）、`@zcode/provider-node`（8 处）、`@zcode/zcode-cua`
   （29 处）、`@zcode/model-option-map`（shared 依赖）。搬运清单据此扩为约 10 包。
7. **工具链差异（审查修正）**：ZCode 基于 TypeScript ^6 与 Node >= 24 构建（oxfmt
   格式化），TNT 现为 TS ^5.6/^5.8、Node >= 20、prettier。用户决定 Node 门槛升至
   > = 24、TypeScript 相应升级；搬入文件不重排格式。

## 目标 / 非目标 / 反目标

**目标**

1. 删除 `packages/cli/webui` 前端源码与构建接线，TNT 仓库内不再保留旧前端。
2. 把 ZCode 的 UI 包群原样搬入 TNT monorepo（清单见"包搬运清单"，约 10 包，
   含审查发现的 provider/provider-node/zcode-cua/model-option-map），
   保留全部视觉、交互、i18n、主题（zai-dark/zai-light），不做观感改动。
3. TNT 后端新增一个 ZCode 服务契约实现层：把 `IZCodeAgentService` 等 UI 实际用到的
   服务接口映射到 TNT 现有引擎（`stream/`、`loop/`、`session/`、`permissions/`、
   `TurnRunnerService`、eventBus、messageQueue），替代原 WebUiService 的 REST/SSE
   路由成为 webui 的数据通道。
4. **多目录支持首版即做（用户决定）**：webui 支持多工作区 —— 每个目录一个 TNT
   agent 引擎实例，工作区切换、目录浏览器可用。这要求 TNT 引擎支持多实例
   （按工作区目录隔离会话与轮次），原"不改 TNT 引擎"的约束就此放开；
   引擎多实例化的改动范围由实施计划划定并单列验收。
5. `packages/server` 的 WebSocket RPC 宿主模式照搬：`tnt webui` / `/webui` 起的
   HTTP 服务增加 `/ws` 升级端点，用 `SocketProtocol` + `ChannelServer` 暴露服务集合，
   浏览器端 `connectViaWebSocket` 原样连接。
6. 现有入口不变：TUI 内 `/webui` 斜杠命令、`tnt webui` 独立命令、loopback + token
   认证、端口 47610 起自动顺延 —— 全部保留，只换数据通道与前端。
7. **TUI 提问中继保留（用户决定）**：TUI 内 agent 向用户提问时，浏览器同步弹出
   同一问题并可回答 —— 做桥接：TNT 的提问流（quizService/interactionBroker）接入
   ZCode UI 的 interaction-request 流，双向同源，与审批同一机制路径。
8. ZCode 的 LICENSE/NOTICE 义务随源码搬运一并保留（THIRD_PARTY_NOTICES.md、
   NOTICE.md 复制进对应包目录）。

**非目标（本期不做）**

- 桌面壳（Electron、托盘、自动更新、CUA 权限面板）—— 仅浏览器。侧边栏嵌入式
  浏览器（Electron `<webview>` 专属）v1 隐藏；CDP 远程浏览器通道列入后续 Phase
  （用户已确认设计预览场景的价值与桌面端路线）。
- 手机远控（web-remote-control relay 协议）—— `packages/web` 的远控分支代码随源码
  搬入但路由不挂载，浏览器入口直达主界面。
- 性能/体积优化 —— 先求正确与观感一致，包体积不做预算约束。
- **云端依赖类功能，用户明确砍掉（2026-11-08）**：订阅/计费/会员套餐、Stripe 支付、
  云端内容同步（cloud content）、会话云分享的云端部分、marketing touch、ZCode 账号
  体系 —— 全部不做，也不做 TNT 侧替代后端。相关 UI 面板用 stub 呈现不可用/隐藏态
  （stub 的呈现义务同上），不接任何云服务。stub 清零原则不适用于本类功能：
  它们是明确砍掉，不是待实现。

**总体范围声明（用户决定，2026-11-08）**

stub 只是分期手段，不是终点：**ZCode 有的功能，TNT 最终全都要有**（全功能对齐，
云端依赖类功能除外，见非目标）。首版优先接通主路径与插件市场（见"服务实现
分期"），其余功能在后续迭代中逐个把 stub 换成真实现。此项目整体按大规模修改
对待，分阶段推进、每阶段可独立验收。

**反目标（视为失败）**

- 修改 `packages/ui` 内任何组件的视觉输出（配色、间距、布局、文案结构）。
- 绕过 ZCode 的服务接口层直接改 UI 组件对接 TNT REST API。
- webui 出现第二个独立于 TUI 会话的引擎（必须同一会话、同一核心）。
- 局域网无认证暴露（沿用 token 门卫与 loopback 绑定）。

## 备选方案（已评估并排除）

- **A. 修复/美化现有自写前端**：用户已明确否决 —— 观感不合格，且永远达不到
  "ZCode 原样"。
- **B. 只搬 `packages/ui`，把服务调用改写为 TNT REST/SSE adapter**：225 个文件、
  58 个接口的调用点重写，观感与行为必然走样，工作量反而大于方案 C。排除。
- **C（选定）. 搬 UI + 服务接口层 + WebSocket RPC 宿主，在 TNT 侧实现服务契约**：
  UI 零改动，接线集中在服务实现层（新写）与 WS 宿主（照搬 `packages/server` 模式，
  TNT 已有 express，加 `ws` 升级即可）。工作量最大但唯一满足"原模原样"。

## 架构

```
浏览器
  └─ packages/web（搬入，入口 main.tsx 裁剪为直连主界面分支）
       └─ connectViaWebSocket → SocketProtocol/ChannelClient（@zcode/rpc，原样）
            │  WSS (ws upgrade, /ws, token 门卫沿用)
            ▼
TNT CLI 进程（/webui 或 tnt webui 起的 HTTP 服务，现有 WebUiService 骨架）
  ├─ 静态托管 web dist（webuiDist 候选路径机制不变）
  ├─ WebSocket upgrade → ChannelServer（照搬 packages/server/http.ts 模式）
  │    └─ ServiceCollection.exposeOnChannelServer(services)
  └─ TNT ZCode 服务实现层（新写，packages/cli/src/webui-zcode/）
       ├─ ZCodeAgentServiceImpl   → stream/loop/session/TurnRunnerService/
       │                            messageQueue/eventBus/permissions
       ├─ FileServiceImpl         → TNT fs 工具层
       ├─ GitServiceImpl          → packages/cli/src/utils/git
       ├─ SettingServiceImpl      → TNT config
       ├─ 其余 ~50 接口           → 按需：真实现 / 不可用 stub（返回 UI 可显示
       │                            的空态错误）
       └─ 服务集合组装：ServiceCollection + descriptors（搬入代码原样提供）
```

依赖方向（TNT 现有 ratchet 不受影响）：搬入的 ZCode 包是自包含子树
（`packages/zcode-ui/*`，互相依赖，**不** import TNT 的 `src/`）；
`packages/cli/src/webui-zcode/` 是唯一 import ZCode 包的 TNT 模块，
等价于现在的 `webuiDist.ts`/`WebUiService.ts` 对前端的单向依赖。
架构守卫测试相应加白名单条目（`architecture.test.ts`、`boundaries.test.ts`）。

## 包搬运清单（约 10 包，均整包复制、保留原目录结构；闭包经审查验证）

| ZCode 包                    | 去向（TNT）                          | 规模       | 处理                                                                                |
| --------------------------- | ------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| `packages/shared`           | `packages/zcode-ui/shared`           | 328 文件   | 原样                                                                                |
| `packages/model-option-map` | `packages/zcode-ui/model-option-map` | 小         | 原样（shared 的依赖）                                                               |
| `packages/rpc`              | `packages/zcode-ui/rpc`              | 16 文件    | 原样                                                                                |
| `packages/client`           | `packages/zcode-ui/client`           | 13 文件    | 原样                                                                                |
| `packages/provider`         | `packages/zcode-ui/provider`         | —          | 原样（纯 TS，无 Electron 依赖；ui/services 共 58 处引用）                           |
| `packages/provider-node`    | `packages/zcode-ui/provider-node`    | 17 文件    | 原样（services/node.ts 引用）                                                       |
| `packages/zcode-cua`        | `packages/zcode-ui/zcode-cua`        | —          | 原样（services cua-permission-broker 引用）                                         |
| `packages/services`         | `packages/zcode-ui/services`         | 503 文件   | 原样（实现随包搬入，运行时由 TNT 实现层覆写注入；含 node-pty 原生依赖，用户已接受） |
| `packages/ui`               | `packages/zcode-ui/ui`               | ~1982 文件 | 原样                                                                                |
| `packages/web`              | `packages/zcode-ui/web`              | 54 文件    | 入口裁剪：去掉 OAuth 登录页/会话分享/远控分支，直达主界面                           |

Electron 专属的 `packages/desktop` 不搬；`packages/server` 不搬但其 http.ts 的
WS 宿主模式在 TNT 侧复刻。`desktop` renderer 的启动编排职责由 TNT 侧 WS 连接 +
裁剪后的 web 入口替代。`services` 包内 Node 专属实现随包搬入，终端服务
（node-pty）真实现；运行时服务集合以 TNT 实现层为准。

## 关键决策

| 决策                 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                       | 归属                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 接线路线             | WS RPC + 服务契约实现（方案 C），UI 零改动                                                                                                                                                                                                                                                                                                                                                                                                 | 唯一满足"原模原样"的路线，用户已确认要完整界面                          |
| 搬运范围             | 6 包整搬，Electron 壳与远控不搬                                                                                                                                                                                                                                                                                                                                                                                                            | 用户："完整的界面，全部都要"指应用界面；桌面壳/手机远控与浏览器形态无关 |
| 旧前端处置           | `packages/cli/webui` 全删（git rm），webuiDist 候选路径指向新 web 构建产物                                                                                                                                                                                                                                                                                                                                                                 | 用户明确要求                                                            |
| TNT 依赖管理         | **沿用 TNT 现有模式**（审查修正：TNT 无根 workspace，各包独立 install、`build:local-deps` 链条串联）：搬入的 zcode-ui 各包自包含安装，追加进 `build:local-deps` 序列；不引入根 workspaces                                                                                                                                                                                                                                                  | TNT monorepo 现实约束                                                   |
| 工具链               | **Node 门槛升至 >= 24（用户决定）**，安装脚本与文档同步；TypeScript 升级到能编译搬入代码的版本（实施计划定具体版本，ZCode 上游为 TS ^6）；搬入文件保持 ZCode 原格式（oxfmt），**加入 `.prettierignore` 与 eslint ignores**，不重排 2900 个文件；守卫测试范围明确排除 `packages/zcode-ui/*` 内部，但 TNT 侧新写代码（webui-zcode 实现层）全在守卫内                                                                                         | 用户选定升级；vendored 格式审查建议                                     |
| 服务实现深度（分期） | **分期推进，最终 stub 清零**（用户决定：ZCode 有的 TNT 全要有，全功能对齐）。**首版（Phase 1）真实现**：会话/聊天流/流式事件/审批/停止/文件/Git/设置 + **插件市场**（列表/安装/卸载/恢复，映射 TNT 的 webuiMarketplace 与 plugins 能力）+ **终端**（node-pty，用户已确认接受原生依赖）；其余接口先 stub（返回 UI 可显示的空态/错误，不许静默挂起），按后续 Phase 逐个替换为真实现                                                          | 用户指定插件市场进首版；全功能对齐见范围声明                            |
| 多工作区             | **首版即做多目录（用户决定）**：每个工作区目录一个 TNT agent 引擎实例，会话与轮次按工作区隔离；工作区切换器、目录浏览器可用。TNT 引擎的多实例化是本方案对引擎侧的唯一结构性改动，改动范围在实施计划中单列                                                                                                                                                                                                                                  | 用户选定"直接做多目录"                                                  |
| TUI 提问中继         | **保留并做桥接（用户决定）**：TNT 的提问流（quizService / interactionBroker）接入 ZCode UI 的 interaction-request 流，TUI 与浏览器双向同源；旧 WebUiService 的提问中继逻辑迁移进桥接层                                                                                                                                                                                                                                                     | 用户选定保留                                                            |
| 云端依赖类功能       | **砍掉**（用户决定）：订阅/计费/会员套餐/Stripe/云同步/云分享云端部分/账号体系/marketing touch 全部不做、不做替代后端、不接任何云服务；相关面板 stub 呈不可用/隐藏态，stub 清零原则不适用                                                                                                                                                                                                                                                  | 用户明确砍掉                                                            |
| 侧边栏浏览器         | **v1 隐藏（用户确认，跟随 ZCode 官方网页版行为）**：`supportsEmbeddedBrowser=false` 过滤侧边栏浏览器入口 —— 它是 Electron `<webview>` 专属，ZCode 官方 web 版同样禁用。**但用户明确该功能对设计类工作（网页设计实时预览）有价值且未来 TNT 会做桌面端**：后续 Phase 规划 CDP 远程浏览器通道（浏览器面板经协议通道接管本地 Chrome，像素流回网页，agent 沿用 ZCode 的 browser-use 协议面）；桌面端立项时按 ZCode desktop 形态原生自带 webview | 用户确认隐藏 + 指明设计场景与桌面端路线                                 |
| 入口与安全           | `/webui`、`tnt webui`、token、loopback、47610 顺延全部沿用现有实现                                                                                                                                                                                                                                                                                                                                                                         | 用户未要求改，现有实现已符合                                            |
| 守卫文化义务         | 新增路径进 docsAccuracy 范围；webui 相关文档（docs/cli、docs/zh/cli）同步更新双语文档行；namingLedger 不受影响                                                                                                                                                                                                                                                                                                                             | TNT 硬规则                                                              |
| 版权                 | ZCode NOTICE.md / THIRD_PARTY_NOTICES.md 随包保留；ui 包 73 个外部依赖的 notices 汇入 TNT 根 THIRD-PARTY-NOTICES                                                                                                                                                                                                                                                                                                                           | Apache-2.0 兼容性：ZCode 与 TNT 同为 Apache-2.0                         |

## 交给实现者的部分（留给 builder）

- **服务实现的分期计划**：58 个接口 × 全部方法的三列清单（真实现映射 / stub /
  所属 Phase），首版 Phase 1 范围见关键决策表；Phase 2+ 排期由 builder 依据
  工作量与依赖关系排序，交付时列出。
- **TNT 引擎多实例化设计**：按工作区目录隔离 agent 引擎实例（会话存储、轮次、
  messageQueue、TurnRunnerService 的实例化与生命周期），改动边界单列验收；
  TUI 进程内多实例与 `tnt webui` 独立进程多实例两种宿主形态都要覆盖。

- `IZCodeAgentService` 155 个方法的逐一映射表：哪些接 TNT 引擎真实能力、哪些 stub、
  stub 的错误形态（对照 UI 的空态/错误分支逐个确认）。
- `packages/web` main.tsx 裁剪的具体切口（保留直连主界面 + 主题初始化 +
  `connectViaWebSocket`；去除 auth/share/remote-control 分支）。
- TNT 服务实现层内部结构（`packages/cli/src/webui-zcode/` 的模块划分）、
  流式事件（TNT eventBus → `ZCodeSessionEvent`）的转换器。
- WS upgrade 与 express 的整合方式（TNT 用 express，ZCode 参考实现用 Hono；
  用 `ws` 库挂 upgrade 事件，`SocketProtocol` 不变）。
- 架构守卫测试的新白名单条目与对应断言。
- 构建接线：`build:local-deps` 序列追加 zcode-ui 各包；`tnt.js` 打包是否内联
  web dist 维持现状（dist/webui 候选机制不变）。

## 验收

1. 删除验证：`packages/cli/webui` 不存在；`grep -r tnt-webui packages/cli/src` 无残留引用；
   全量测试通过。
2. `tnt build` 后 `tnt webui` 起服务，浏览器打开 → ZCode Desktop 主界面（任务列表、
   聊天流、输入框、Git 面板、设置）与 ZCode 源码运行观感一致（zai-dark 默认主题）。
3. 浏览器发消息 → TNT 引擎跑轮次 → 流式输出、工具卡、审批卡在网页正常呈现，
   审批点击生效，停止按钮截断轮次（与 TUI 同一会话、同源事件）。
4. **多工作区（用户决定）**：目录浏览器可添加第二个工作区目录并切换；两个工作区
   各自独立的会话与轮次互不干扰；TUI 进程内的 webui 与独立进程 `tnt webui`
   均支持。
5. **提问中继（用户决定）**：TUI 内 agent 提问 → 浏览器弹出同一问题，浏览器作答
   后 TUI 继续；反向（浏览器触发的审批/提问）同样两个表面可见。
6. 会话列表/历史、文件树、Git 状态、**插件市场**、**浏览器终端**走 TNT 真实数据；
   stub 接口（云端依赖类与其他延后功能）在 UI 呈现空态或明确的"不可用"提示，
   无静默失败。
7. 无 token 访问拒绝；token 门卫覆盖 WS upgrade 握手。
8. TNT 守卫全绿：lint、vitest 全量、docsAccuracy、双语文档、prettier —— 范围为
   TNT 既有代码与新写代码；`packages/zcode-ui/*` 按 vendored 规则排除在
   prettier/eslint 之外（见关键决策表）。
9. 界面视觉零改动：对照 ZCode 源码截图逐屏比对（主界面、设置、会话详情）。
10. Node >= 24 门槛：安装脚本、`engines` 字段、文档三处一致；CI 矩阵全部节点
    node 24 通过。
