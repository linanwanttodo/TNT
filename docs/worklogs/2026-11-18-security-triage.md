# 安全审计对账与修复（2026-11-18）

本文件是对 Mimosa deep 扫描（`scan-2026-11-17T15-49-33.194Z-c3d18bb11900`，seal
`sha256:2ccd9bbd0516e04d96ab46dfa1b043e543cde82fccf4c805555a7ff7d4499b3e`）全部 171 条
finding 的逐簇对账与修复记录。扫描本身标注 `static only, not runtime verification`、
verdict effect `none`；本文每一条结论都给出可复核的依据（守卫位置/信任边界/测试属性）。
相关仓库目录：`packages/cli/src/`、`packages/config-yaml/src/`、`packages/zcode-ui/`、
`packages/fetch/src/`、`core/`、`docs-site/`。

## 总口径

171 条 = 135 HIGH + 36 MEDIUM。逐簇复核后分四类：

| 处置                       | 数量                       | 说明                                                                                                                             |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 真实修复（FIX）            | 1 簇（serve 面）+ 2 项依赖 | 见下文「修复」                                                                                                                   |
| 已有守卫（GUARDED）        | 51                         | 汇点处或其上游存在可指认的边界检查                                                                                               |
| 信任边界（TRUST-BOUNDARY） | 44                         | 输入来自操作员自己的配置/环境/自己启动的进程；仓库的威胁模型以操作员为锚（同 `session/paths.ts` 对 `TNT_GLOBAL_DIR` 的既有决定） |
| 测试/沙箱材料（TEST）      | 14                         | vitest 用例、手工实验沙箱，不随发布物分发                                                                                        |
| 证据缺失（NO-EVIDENCE）    | 60                         | finding 无污点链（`proofGaps: []`）或标签与代码不符（详见 zcodeAgentService 一节）                                               |

数字按文件×条目归簇统计，允许与逐条计数有 ±1 的口径差（一条 finding 可能同时支撑两条标签）。

## 修复

### 1. serve HTTP 面的强制令牌门（FIX，代码）

- **问题**：`tnt serve` 的 API 能发布提示词、批准工具权限、暂停运行；默认只绑
  `127.0.0.1`，但 `--host 0.0.0.0` 显式放开时服务器完全匿名（代码注释与
  `spec/wire-format.md` 都如实写了这一点）。审计的 MEDIUM 业务逻辑候选
  （`serve.ts:294 POST /permission`）指的就是这个面。
- **修复**：
  - `serve.helpers.ts` 新增 `isLoopbackServeHost`（精确名单：`127.0.0.1`/`localhost`/`::1`）、
    `serveTokenRefusal`（非环回且无令牌 → 拒绝启动并给出 `--token` / `TNT_SERVE_TOKEN` 指引）、
    `serveTokenGateHandler`（Bearer 头、webui token cookie、`?token=` 三种携带方式；`?token=`
    是给无法设请求头的 EventSource 用的）与 `registerServeTokenGate`。
  - `serve.ts` 在任何 bind 之前解析令牌并拒绝非环回匿名绑定；令牌在位时门注册在全部路由之前
    （环回上也生效，纵深防御）；启动横幅在门生效时打印 `serve.tokenGateActive`。
  - `--token <token>` 旗标加入 serve 子命令；`--host` 帮助文案改写为「非环回需要令牌」。
  - `spec/wire-format.md` 的 Security Considerations 重写；`TNT_SERVE_TOKEN` 进入
    `branding.test.ts` 的环境变量接口清单与 configuration.mdx 表（en/zh）。
  - 远端驱动客户端（`ui/hooks/useChat.remote.helpers.ts` 的 5 处 fetch）在
    `TNT_SERVE_TOKEN` 在位时携带同一令牌（`Authorization: Bearer`），两侧读同一个
    环境变量名，所以环回无令牌的用法与暴露面带令牌的用法都不需要新的配置位。
  - `serveSurface.test.ts` 的「spec 与实现同步」守卫新增配对断言：spec 声明的令牌
    必要性与代码里的 `serveTokenRefusal`/`registerServeTokenGate` 必须同时存在。
  - **测试**：`serve.tokenGate.test.ts`（环回名单、拒绝/放行、五种拒答形态）；
    `e2e/serve-http.test.ts` 新增「非环回无令牌拒绝启动」「带令牌后环回 401/200、暴露面
    401、Bearer 与 `?token=` 放行」两例；原「绑不上要报错」用例补 `--token` 以到达 bind
    失败路径。

### 2. 依赖面：tar 7.5.23 与 follow-redirects 1.16.3（FIX）

- **问题**：`npm audit --omit=dev` 报 15 项（1 critical、10 high）。critical 是
  `tar ≤7.5.20` 的硬链接/符号链接路径穿越族（GHSA-34x7…、GHSA-8qq5… 等 12 条公告），
  而 `core/util/safeTarball.ts` **在运行时**用 tar 解包插件市场的压缩包——
  敌意归档正是这组 CVE 的攻击面，可达性成立。`follow-redirects 1.16.0-1.16.1`
  （high）经 axios 可达。
- **修复**：core 的 `tar` 依赖与 overrides 升到 `^7.5.23`（运行时实际解析 7.5.23）；
  cli 增加 overrides `tar ^7.5.23`（覆盖 sqlite3 安装链里的 tar@6.2.1）与
  `follow-redirects ^1.16.3`。重审计：15 → 12 项，**critical 归零**，follow-redirects
  清零。`safeTarball.vitest.ts` 7 例与 plugins/utils 594 例全绿，解包行为未变。

### 3. 缓修登记（依赖，破坏性主版本，暂不动）

| 包                                                               | 现状                                  | 为什么缓修                                                                                                           | 路线                                          |
| ---------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `zod 3.25.76`（high，GHSA-mrhx…）                                | 经 openai@4、config-types/config-yaml | openai 4.x 锁 zod ^3，升级需 openai@7 大版本迁移；受影响面是超大集合校验 DoS，输入是操作员自己的配置与 provider 响应 | 单独批次升 openai@7 + zod@4                   |
| `protobufjs ≤7.6.2`（high ×10）                                  | 经 onnxruntime-web 1.14 → onnx-proto  | 只在选了 embeddings 模型时加载；模型文件来自操作员选择的 HF 仓库；升级要动 vendored transformers 的运行时 pin        | 跟随 onnxruntime-web 升级批次                 |
| `sqlite3 5.1.7` 安装链（@tootallnate/once、make-fetch-happen@9） | node-gyp/node-pre-gyp 安装期          | 仅在缺 prebuild 从源码安装时执行，来源是 HTTPS registry；`npm audit fix --force` 会装 sqlite3@6.0.1（breaking）      | 评估 sqlite3@6 或换 better-sqlite3 时一并处理 |
| `minimatch 7–11`（moderate）                                     | cacache/rimraf/node-gyp 内部 glob     | 输入是包内部缓存键而非敌意 pattern                                                                                   | 随上述批次顺带                                |

`npm audit fix`（非破坏）没有可用项——剩余项全部需要主版本迁移，逐条理由如上。

## 逐簇对账

判定依据都写在簇名后：守卫在哪个文件哪一行、输入来自谁、或该 finding 是测试材料。
「守卫」均可点开复核。

| 文件                                                                                                | 条数         | 处置                            | 依据                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/session/index.ts`                                                                 | 26           | GUARDED                         | lease 全部经 `store.ts:581 assertSessionId` + `paths.ts` 每个 join 过 `resolveWithin`；id 白名单 `[A-Za-z0-9._:-]` 且拒绝 `.` `..` 与分隔符                         |
| `packages/zcode-ui/services/src/zcode-agent/zcodeAgentService.ts`                                   | 50           | NO-EVIDENCE                     | 标签与代码不符：`mongo-sort-injection` 落在 `getNetworkErrorCodes`（一个错误码提取器）；`proofGaps: []` 无污点链；被点名行不含 fetch；下游是本地 runtime 协议客户端 |
| `packages/cli/src/acp/supervisor.ts`                                                                | 11           | TRUST-BOUNDARY                  | worker 入口 = `TNT_ACP_WORKER_ENTRY` 环境变量或 `process.argv[1]`（操作员自己启动的 CLI）；pid 全部来自 spawn 返回值；数组式 spawn 无 shell                         |
| `packages/zcode-ui/services/src/zcode-agent/zcodeAgentProcessManager.ts`                            | 2            | TRUST-BOUNDARY                  | 拉起的是产品自身 runtime 二进制，带 spawn preflight                                                                                                                 |
| `packages/cli/src/utils/clipboardImage.ts`                                                          | 6            | GUARDED                         | 二进制名与旗标全是常量，剪贴板 MIME 作为 argv 元素传递，无 shell（文件内注释即设计说明）                                                                            |
| `manual-testing-sandbox/next-edit/*.ts`                                                             | 9            | TEST                            | 手工实验沙箱，不进发布物                                                                                                                                            |
| `packages/cli/src/commands/serve.ts`                                                                | 6            | FIX（+5 条指向 e2e 的污点噪音） | 见修复 1；污点链终点是 `e2e/serve-http.test.ts` 自己的 post()                                                                                                       |
| `packages/zcode-ui/services/src/zcode-agent` 以外 node.ts                                           | 7            | TRUST-BOUNDARY                  | fetch 目标 origin 来自 provider/账号配置（与所有 model provider base URL 同类）                                                                                     |
| `core/context/mcp/MCPOauth.vitest.ts`                                                               | 4            | TEST                            | 用例                                                                                                                                                                |
| `core/util/sanitization.vitest.ts`                                                                  | 1            | TEST                            | 该用例的恶意串正是被测输入                                                                                                                                          |
| `packages/cli/src/hooks/hookRunner.ts`                                                              | 3            | TRUST-BOUNDARY                  | hook 命令来自操作员的 hook 配置（hook 本就是操作员自己的自动化）；`killProcessTree` 只用 spawn 返回的数字 pid；数组式 spawn                                         |
| `packages/cli/src/services/webuiAuth.ts`                                                            | 3            | GUARDED+DESIGN                  | `:37` join 的是操作员锚 globalDir+常量；`:91` 的 POST /webui-session 豁免正是鉴权握手，handler 内 `tokenEquals` 校验后才发 cookie                                   |
| `packages/cli/src/session/paths.ts`                                                                 | 1            | GUARDED                         | 被点名的 `resolveWithin` 本身就是守卫函数                                                                                                                           |
| `packages/cli/src/startup/onboarding.ts`、`ProviderSetupScreen*`                                    | （随 ui 簇） | —                               | 与安全无关的键序修复，见 lint 批次                                                                                                                                  |
| `packages/cli/src/ui/utils/editorUtils.ts`                                                          | 1            | TRUST-BOUNDARY                  | `$VISUAL`/`$EDITOR`（与 git 同一模式），argv 传参；win32 shell:true 是操作员自己的编辑器串                                                                          |
| `packages/zcode-ui/services/src/runtime-tools/runtimeLoginShellEnvCapture.ts`                       | 3            | TRUST-BOUNDARY                  | 该工具的目的就是执行用户自己的 login shell 采集环境                                                                                                                 |
| `packages/zcode-ui/services/src/cua-permission-broker/windowsCuaDevRuntime.ts`                      | 12           | GUARDED                         | 被点名的 `requireDevelopmentRuntimeRoot`/`requireExpectedPackage`/`requireContainedRegularArtifact` 全是含边界校验的守卫函数，扫描器把守卫当入口                    |
| `packages/zcode-ui/services/src/cua-permission-broker/windowsCuaDevHelperHost.ts`                   | 1            | NO-EVIDENCE                     | 被点名行是错误处理分支，无 sink                                                                                                                                     |
| `packages/zcode-ui/services/src/model-provider/codingPlanProviderAvailability.ts`                   | 1            | TRUST-BOUNDARY                  | origin 来自 `buildRuntimeZaiBusinessUrl(env)`/`resolveBigModelApiOrigin(env)`（provider 配置），路径常量                                                            |
| `packages/zcode-ui/services/src/model-provider/zaiStartPlanBilling.ts`                              | 1            | TRUST-BOUNDARY                  | 同上                                                                                                                                                                |
| `packages/zcode-ui/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts` | 1            | TRUST-BOUNDARY                  | post 到 provider 配置 origin + 固定路径                                                                                                                             |
| `packages/zcode-ui/services/src/session/offPeakRuntimeModel.ts`                                     | 1            | NO-EVIDENCE                     | `"offpeak-mock-jwt"`/`"offpeak-mock-key"` 是 `ZCODE_OFFPEAK_MOCK=1` 下的确定性 mock 凭据，注释即说明                                                                |
| `packages/zcode-ui/services/src/session/offPeakMockGateway.ts`                                      | 1            | TEST                            | mock 网关在脚本化场景里寻址自己的测试端口                                                                                                                           |
| `packages/zcode-ui/shared/src/project-access-token-client.ts`                                       | 1            | NO-EVIDENCE                     | `"zcode-team-api-key"` 是 API key 的名字，不是凭据                                                                                                                  |
| `packages/zcode-ui/shared/src/test-ids.ts`                                                          | 2            | NO-EVIDENCE                     | DOM test-id 字符串                                                                                                                                                  |
| `packages/zcode-ui/ui/src/plugin-ui/app/pluginUiResourceSubscriptions.ts`                           | 1            | GUARDED                         | URI 只回送到发布它的插件 bridge，无文件系统 sink                                                                                                                    |
| `packages/zcode-ui/web/src/platform/saveBrowserFile.ts`                                             | 1            | NO-EVIDENCE                     | 代码在浏览器里执行（`window.location.href`、`document.createElement`），是客户端下载而非服务端请求                                                                  |
| `packages/config-yaml/src/registryClient.ts`                                                        | 1            | GUARDED+TRUST                   | 相对路径回退有显式逃逸检查（注释即说明）；绝对路径/file:// 分支读操作员配置的 registry 条目                                                                         |
| `packages/cli/src/config/hubLoader.ts`                                                              | 1            | TRUST-BOUNDARY                  | 读操作员在自己配置里写的规则路径；插件本就是完全可信代码（可声明任意命令）                                                                                          |
| `packages/cli/src/lsp/manager.ts`                                                                   | 1            | TRUST-BOUNDARY                  | 读模型给的绝对路径，与 Read 工具同一策略面（文件级 deny 规则同样生效于 Search 忽略清单）                                                                            |
| `packages/cli/src/plugins/directories.ts`                                                           | 1            | TRUST-BOUNDARY                  | `TNT_PLUGINS_DIR` 是操作员环境变量，`expandTilde` 只做 ~ 展开                                                                                                       |
| `packages/cli/src/plugins/marketplaceSources.ts`                                                    | 1            | GUARDED                         | join 的是常量 `MANIFEST_RELPATH`                                                                                                                                    |
| `packages/cli/src/plugins/pluginArchive.ts`                                                         | 1            | GUARDED                         | `safeRelative` 拒绝 `..`/`.`/绝对路径/反斜杠/冒号/控制字符；另有 mode 校验、staging 目录、manifest 名校验后才 rename                                                |
| `packages/cli/src/retrieval/importGraph.ts`                                                         | 1            | GUARDED                         | 图的键全部来自 walkDir 实走文件；传入遍历路径只会查空，无内容回读                                                                                                   |
| `packages/cli/src/services/UpdateService.ts`                                                        | 1            | TRUST-BOUNDARY                  | 用进程自己的 argv 重启自己                                                                                                                                          |
| `packages/cli/src/team/loader.ts`                                                                   | 1            | GUARDED                         | 条目来自 `readdirSync` 列表，单项不可能含路径分隔符                                                                                                                 |
| `docs-site/lib/docs.ts`                                                                             | 3            | GUARDED                         | locale 回退两处已有 `withinRoot` 检查；`preprocessMdx` 是纯正则文本处理，无命令执行                                                                                 |
| `packages/fetch/src/node-fetch-patch.js`                                                            | 1            | TRUST-BOUNDARY                  | vendored node-fetch 的重定向步（step 15）；URL 来源是操作员配置的 provider/base URL                                                                                 |

## 遗留与建议

1. **依赖破坏性批次**：openai@7+zod@4、onnxruntime-web 升级（带 protobufjs）、
   sqlite3@6 或替换。三批都已登记理由与路线；zod/protobufjs 的可达输入目前都在
   操作员或 provider 一侧。
2. **扫描器协作**：`zcodeAgentService.ts` 的 50 条里标签与代码不符的比例过高
   （mongo-sort-injection 落在错误码提取器上），建议下一轮 Mimosa 对该文件提供
   污点链证据（`proofGaps` 为空时降级为 candidate 而非 HIGH）。
3. **审计口径**：Mimosa 的依赖离线公告匹配是名称级粗匹配（39 包/244 公告，未给出
   包名），不可据此改依赖；本次以 `npm audit --registry=registry.npmjs.org
--omit=dev` 为准。npmmirror 镜像不支持 audit 端点，审计需显式指向官方源。
4. **复扫**：代码与依赖修复合入后，重跑 Mimosa deep 对账本轮 seal。

## 验证

- `serve.tokenGate.test.ts` 3 例；`e2e/serve-http.test.ts` 7 例（含两个新令牌用例）。
- `safeTarball.vitest.ts` 7 例；cli `src/plugins/` + `src/utils/` 595 例。
- `npm audit --omit=dev`（官方 registry）：15 项 → 12 项，critical 0，follow-redirects 清零。
- 受影响门禁重跑结果见提交记录（lint、branding、architecture、i18n、e2e serve）。
