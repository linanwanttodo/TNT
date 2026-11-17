# 压缩死循环、阈值与输入体验修复（2026-11-17）

本文件记录压缩子系统的一组严重缺陷定位与修复：固定压缩上限导致的 10% 早压缩与
死循环、压缩摘要泄漏到界面、ESC 停止后队列消息自动续跑、运行中 `/` 命令面板不
显示、添加模型向导无法用 ESC 退出。所有结论来自本地源码比对与一次真实会话文件
的证据，参考实现为本地已有的 pi、Cursor（逆向参考）与 ZCode 源码。

## 参考实现的触发点（调研结论）

| 实现               | 触发条件                             | 压缩后保留                                                                                        | 防循环                                                   |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| pi                 | `tokens > window − 16k`              | 最近 ~20k 原文（keepRecentTokens），旧 compaction 条目不再进摘要                                  | —                                                        |
| Cursor（逆向参考） | `input > window − window/10`（90%）  | 从最新往回保留能放进预算的完整轮次；连最新一轮放不下也保留最新轮；压缩后校验 `estimated ≤ budget` | provider 拒绝才触发                                      |
| ZCode              | `window − min(maxOutput, 21k) − 13k` | 只留 context prefix + 摘要 + 保留组；不足两轮不压缩                                               | 连续 3 次失败熔断；prompt-too-long 按 token gap 再丢旧轮 |

TNT 采用 Cursor 的 90% 比例触发（用户指定），去掉固定绝对上限。

## 1. 固定 100k 压缩上限 → 1M 窗口 10% 就压缩（已修复）

- 现象：1M 窗口的模型在 13% 左右就触发压缩；状态栏显示 `13.2%/1.0M`。
- 根因：`core/util/contextPolicy.ts` 的 `compactCeilingTokens: 100_000` 把
  `min(0.8×窗口, 100k)` 作为触发点；文档（ARCHITECTURE-tnt.md）写的是 200k，与代码
  不一致。
- 修复：`compactRatio` 提到 0.9（Cursor 触发点），绝对上限从默认策略中移除，仅
  `TNT_COMPACT_CEILING` / `TNT_COMPACT_RETAIN` 显式设置时生效；retain 尾仍受
  32k 绝对上限约束。
- 文件：`core/util/contextPolicy.ts`、`core/util/contextPolicy.vitest.ts`、
  `packages/cli/src/compaction/index.ts`（`tunedContextBudget` 改为可选上限）、
  `docs/cli/context.mdx`、`docs/zh/cli/context.mdx`。

## 2. 压缩死循环（已修复）

- 现象：压缩反复触发、上下文一直增长；会话文件
  `~/.tnt/sessions/c23ba739-…/session.jsonl` 392 行里没有一条 `compaction` 记录，
  说明压缩结果从未落盘成功，每轮重新花一次摘要调用。
- 根因（三个叠加）：
  1. 触发点 100k 低于「固定前缀（system + 工具定义）+ 保留尾」，压缩后仍在阈值上，
     于是每轮再压；
  2. 摘要无收益（`abandoned`）按设计不计熔断，循环无停止机制；
  3. 摘要要跑几十秒，期间 history generation 变化时 `replaceSessionHistoryIfGeneration`
     放弃落盘，下轮重来。
- 修复：
  - `core/util/autoCompaction.ts` 新增 `consecutiveNoProgress` 计数与
    `recordCompactionNoProgress`；`isCompactionBreakerTripped` 同时看失败与无进展
    两个计数（各 3 次）。
  - `stream/streamChatResponse.autoCompaction.ts`：`abandoned` 计入无进展；压缩成功
    但结果仍在阈值上（`stillOverTrigger` 检查）也计入无进展；两者任一连续 3 次即熔断，
    会话停止自动压缩并记录原因。
- 测试：`streamChatResponse.autoCompaction.test.ts` 重写「无进展不熔断」用例为新契约
  （三次无进展后停），新增「中断后不再摘要」「压缩后仍过线计无进展」两个用例。

## 3. 压缩摘要泄漏到界面（已修复）

- 现象：压缩时摘要全文以助手正文的形式边生成边打印；压缩后又以 Markdown 卡片再次
  打印。其他实现都只显示一条边界。
- 根因：`onStreamContent: callbacks?.onContent` 把摘要分片接进了助手内容通道；
  `CompactionBoundary` 把摘要全文渲染进转录区；WebUI 投影把压缩项当普通助手消息。
- 修复：
  - `streamChatResponse.autoCompaction.ts` 不再向 `compactChatHistory` 传任何内容回调，
    `AutoCompactionCallbacks.onContent` 字段删除（防回归）；
  - `ui/components/CompactionBoundary.tsx` 只画一行 `── context compacted ──`；
  - `appServer/snapshot.ts` 的 `toZcodeMessages` 对压缩项发出 `type: "compaction"` part
    （带 `summaryMessageId`），WebUI 时间线渲染分隔节点，正文不进聊天区。
- 测试：`CompactionBoundary.test.tsx` 改为断言摘要正文不出现。

## 4. ESC 停止后自动续跑（已修复）

- 现象：ESC 中断后过一会儿又自己开始思考。会话里当时有一条排队消息（「继续啊」）。
- 根因：`useChat.ts` 的 `executeStreamingResponse` 在 `finally` 里无条件把消息队列交给
  排空循环——被中断的回合也会把中断前排队的消息作为新回合发出；且自动压缩路径虽然
  收到 AbortController 却从不使用（参数名 `_abortController`），ESC 无法真正取消摘要。
- 修复：
  - `finally` 里 `controller.signal.aborted` 时清空消息队列并跳过排空；
  - `AutoCompactionOptions` 增加 `abortController`，传入 `compactChatHistory`，摘要请求
    随 ESC 真正取消；中断路径不计失败、不计无进展；
  - `useChat.ts` 两条「发送前压缩」路径在中断后直接返回，不再把消息加入历史。
- 文件：`ui/hooks/useChat.ts`、`ui/hooks/useChat.compaction.ts`、
  `stream/streamChatResponse.autoCompaction.ts`。

## 5. 运行中 `/` 命令面板不显示（已修复）

- 现象：回合运行中输入 `/` 不弹命令面板；连带后果是 `/goal xxx` 提交时面板状态仍在
  （只是不渲染），Enter 被面板导航吞掉，命令看起来毫无反应。
- 根因：面板渲染条件要求 `inputMode`，而 `useChat` 在回合开始时 `setInputMode(false)`，
  整个回合期间面板被压住；输入框本身仍可编辑（`focus={inputMode || isWaitingForResponse}`）。
- 修复：新增 `composerInteractive = inputMode || isWaitingForResponse || isCompacting`，
  两个 `SuggestionOverlay` 与 `SlashCommandsMaybe` / `FileSearchMaybe` 都改用它。
- 测试：`UserInput.slashPalette.test.tsx` 新增 `inputMode=false + isWaitingForResponse`
  与压缩中两个用例。

## 6. 添加模型向导 ESC 无法退出（已修复）

- 现象：模型选择器 → 添加模型，到 API key 一步按 ESC 退出不了，字段还像被填了空白。
- 根因：向导用 ink 的 `useInput` 读键，而应用其余部分统一走 `KeypressContext` 解析；
  终端协商 Kitty 键盘协议或 modifyOtherKeys 后两个解析器不一致，ink 侧看不到
  Escape/Enter，向导就被困住。
- 修复：`startup/ProviderSetupScreen.tsx` 改用 `useKeypress`（`KeypressPriority.Critical`，
  每个键消费后返回 true）；Escape 每一步都可退出；裸换行（解析为 ctrl+j）按 Enter 处理，
  保持旧行为；首次启动的独立渲染入口（`startup/onboarding.ts`）包上 `KeypressProvider`。
- 测试：`ProviderSetupScreen.test.tsx` 包 Provider 渲染，新增「API key 步骤 ESC 可退出」。

## 边界与未做

- 工具输出驱逐阈值仍是 `min(100k tokens, 40% 窗口)`（`stream/toolOutputEviction.ts`）。
  它是成本护栏且只在缓存冷窗生效，与压缩触发是两件事；1M 窗口下它仍然在 100k 输入时
  清理旧工具结果。若要跟随窗口放大，另行决策。
- 压缩落盘的 generation 竞态保留原语义：并发写入会话仍会让当次压缩结果被丢弃（新的
  熔断保证不再无限重试）。若 WebUI 与终端同时写同一会话，仍可能看到一次压缩白跑。
- 主 agent 正在本仓库并行开发（appServer/session debug、processStreamingResponse 等）；
  本轮改动集中在 `core/util`、`compaction/`、`stream/streamChatResponse.autoCompaction*`、
  `ui/hooks`、`ui/components/CompactionBoundary*`、`ui/UserInput.tsx`（渲染条件一处）、
  `startup/ProviderSetupScreen*`、`appServer/snapshot.ts`，与其改动文件不重叠。

## 7. 测试套件清空真实会话目录（已修复，数据不可恢复）

- 现象：`~/.tnt/sessions` 里 4.7MB 的真实会话（c23ba739-…）连同其余全部会话被物理
  删除，只剩一个测试写进去的 `Test Session`（消息内容 "one"）。关闭/归档会话本身
  **不删除**文件（`session/close` 与 TUI 关闭只改 archived 状态），所以删它的不是
  "关闭对话"。
- 根因（两处叠加）：
  1. `src/session/paths.ts` 的 `getSessionDir()` 先检查 `TNT_TEST && HOME` 再看
     `TNT_GLOBAL_DIR`——测试模式把会话根锚到**真实的** `$HOME/.tnt/sessions`，使
     `vitest.global-dir-setup.ts` 精心准备的每 worker 隔离目录对会话存储完全失效；
  2. `src/session/store.test.ts` 的 `beforeEach` 先 `TNT_GLOBAL_DIR = testRoot` 然后
     紧接着 `delete process.env.TNT_GLOBAL_DIR`（自相矛盾的意外），随后
     `sessionStore.clearAll()` 整目录 `rmSync`——每跑一次该文件就把操作者的全部真实
     会话清空一次。2026-11-17 23:40 的全量测试运行即是最后一次。
- 修复：
  - `paths.ts`：`TNT_GLOBAL_DIR` 永远优先于测试锚；`TNT_TEST && HOME` 只在无显式
    覆盖时兜底。
  - `store.test.ts`：删掉自删覆盖的意外行，并在 `clearAll()` 前断言
    `getSessionDir()` 落在测试目录里。
  - `paths.test.ts`：新增「覆盖优先于测试锚」回归用例。
  - `tools/uploadArtifact.test.ts`：改用 `TNT_GLOBAL_DIR` 隔离（旧写法依赖
    `TNT_TEST+HOME` 锚），路径经 `getSessionRoot` 构造。
  - `test-utils/cli-helpers.ts` 与 `smoke-api/smoke-api-helpers.ts`：spawn 子进程时
    显式传 `TNT_GLOBAL_DIR: testDir`，因为它们用 `...process.env` 继承了 runner 的
    覆盖值。
- 后果说明：被清空的历史转录无法恢复（`rmSync` 无备份）；`~/.tnt/logs/tnt.log` 仍
  保留了该会话的压缩循环时间线（21:00–22:21 四次自动摘要调用、227k+ 输入 tokens、
  最后一次 139,443 输入后以「压缩摘要为空」失败收场），与本文件第 1、2、4 节的根因
  完全对应。

## 8. 手机局域网 WebUI：`crypto.randomUUID is not a function`（已修复）

- 现象：手机经局域网 `http://192.168.x.x:port` 打开 WebUI 不同步会话、发送消息报
  「模型报错」；桌面 CLI 与 WebUI（127.0.0.1）都正常。
- 根因：`randomUUID` 与 `subtle` 是 secure-context-only API。`127.0.0.1` 属于安全
  上下文所以桌面都有；手机走明文 http 的局域网地址，两者**不存在**——UI 里 21 处
  `crypto.randomUUID()`（commandFactory 的会话/命令 id、上传事务、hook id 等）在
  生成 id 时直接抛异常，附件上传的 `subtle.digest` 同样会挂。
- 修复：新增 `zcode-ui/ui/src/lib/secureContext.ts` 的
  `installInsecureContextCryptoPolyfill()`——缺失时在 crypto 对象上补
  `randomUUID`（getRandomValues 出真 v4）与 `subtle.digest("SHA-256")`（纯 JS 实现，
  输出与原生逐字节一致，已对照 node crypto 验证）；`web/src/main.tsx` 入口安装，
  桌面安全上下文下是静默 no-op。`ui` 包新增 export `./lib/secureContext`。
- 验证：ui tsc 通过、ui vitest 16 项通过、`zcode-ui/web` vite build 通过。
- 生效条件：WebUI 前端是打包产物，需要重新 `build:webui` + 重打包安装后手机才拿到。

## 9. 会话删除改入回收站（已修复）

- 用户要求：会话必须保留，程序不得悄悄销毁。此前 `sessionStore.delete()` 直接
  `rmSync` 会话目录——webui/ACP 的删除请求一旦误触（或如第 7 节的测试事故）即不可
  恢复。
- 修复：`delete()` 改为把会话目录 **rename 到 `<root>/trash/sessions/<时间戳>-<id>`**，
  legacy 转录与 sidecar 同样入回收站；回收站保留最近 50 个（`TRASH_KEEP_COUNT`），
  更早的自动裁剪。跨设备 rename 失败时退回原硬删除。新增回归测试：删除后转录在
  回收站中完整可读。
- 文件：`src/session/paths.ts`（`getSessionsTrashDir`）、`src/session/store.ts`、
  `src/session/store.test.ts`。

## 验证

- `core`：`contextPolicy.vitest.ts` 7 项通过；`tsc -p ./ --noEmit` 通过。
- `packages/cli`：`npx tsc -p . --noEmit` 通过；`src/stream` + `src/compaction` 68 个文件
  417 项通过；`src/ui` 157 个文件 1079 项通过；`src/startup/ProviderSetupScreen.test.tsx`
  7 项通过；第 7 节修复后全量 5292 项通过，且整轮测试运行后 `~/.tnt/sessions` 保持
  原样（不再出现测试写入或删除）；smoke 10 项通过；lint 通过。
- `packages/zcode-ui/ui`：tsc 通过、vitest 16 项通过；`zcode-ui/web` vite build 通过。
