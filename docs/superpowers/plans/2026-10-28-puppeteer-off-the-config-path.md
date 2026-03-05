# 计划：把 puppeteer 与注册表残留从 CLI 的静态图上切掉

**分支**：`test`（工作区 `/home/lin/All_projects/GithubProjects/continue/.vitest/worktree`）
**起点**：`c8672b613`
**作者/执行**：本轮由 agent 全权执行，owner 睡觉，完成后开 PR 跑 CI 并修到全绿。
**为审阅者写**：每一步都给了「复现命令 + 预期数字 + 回滚方式」。任何一步的数字对不上，就是这一步的结论有问题，不是测量方法有问题。

---

## 一、要解决的问题

`2026-10-27` 那份分析报告把这件事列为 P0-1，但它给的传导链是**配置层 → 注册表**那一条。那条已经做完了（`ef73fc6c0`），做完之后重新测量发现：**真正还在静态图上压着 854 KB 的是另一条链**，一条为了一个 5 行纯函数而存在的边。

### 1.1 实测的静态链（6 跳）

从 `build-meta.json` 的**文件级** `import-statement` 图 BFS 得出，不是人肉读代码猜的：

```
1. packages/cli/src/retrieval/service.ts
2. core/indexing/CodebaseIndexer.ts:23        import { embedModelsAreEqual } from "./docs/DocsService.js"
3. core/indexing/docs/DocsService.ts:34       import DocsCrawler from "./crawlers/DocsCrawler"
4. core/indexing/docs/crawlers/DocsCrawler.ts:6   import { ChromiumCrawler, ChromiumInstaller } from "./ChromiumCrawler"
5. core/indexing/docs/crawlers/ChromiumCrawler.ts:4,8   puppeteer + puppeteer-chromium-resolver
6. core/node_modules/puppeteer-chromium-resolver/lib/index.js
```

`embedModelsAreEqual`（[DocsService.ts:93-102](file:///home/lin/All_projects/GithubProjects/continue/.vitest/worktree/core/indexing/docs/DocsService.ts#L93)）是**零运行时依赖**的三字段比较：

```ts
llm1?.underlyingProviderName === llm2?.underlyingProviderName &&
  llm1?.title === llm2?.title &&
  llm1?.maxEmbeddingChunkSize === llm2?.maxEmbeddingChunkSize;
```

而 `DocsService` 的**入边只有三条**（已核）：`CodebaseIndexer.ts:23`（只为这个函数）、`DocsContextProvider.ts:11`、`migrations.ts:6`（方向相反，是 DocsService 引 migrations）。所以第 2 跳一断，整条链就断。

### 1.2 基线数字（`c8672b613`，重建后实测）

| 指标                                                  | 值                                                    |
| ----------------------------------------------------- | ----------------------------------------------------- |
| 配置路径（`service-*.js` 的 `import-statement` 闭包） | 3,806 inputs / **21,138,081 B**                       |
| 其中 puppeteer/chromium                               | **280 模块 / 854,372 B**                              |
| 其中 `core/indexing/docs/*`                           | 25,308 B                                              |
| 其中 `core/context/providers/*` 模块数                | 4                                                     |
| 进程启动闭包（`dist/index.js`）                       | 442 inputs / 844,600 B，**注册表与 puppeteer 均为 0** |

> 最后一行是上一轮已记录的事实，写明以防审阅者把它当成本计划的目标：**本计划不动、也无法改善进程启动闭包**。改善的是「第一次用到检索/配置时必然求值的那张图」。

---

## 二、目标与不做什么

**目标**

1. `service-*.js` 的静态闭包内 puppeteer 模块数 **280 → 0**，字节 **854,372 → 0**。
2. `core/staticImportBoundary.vitest.ts` 的冻结清单 **9 条 → 空**，六个 consumer 全部零静态注册表导入。
3. 一个防回退测试，把 1 和 2 固定在 CI 上（构建后检查，因为 `build-meta.json` 是 gitignore 的产物）。

**不做**

- 不删 `core/context/providers`、`core/tools`（那是报告里的 B3，属于产品决策：CLI 现在确实**没有任何地方调用** provider 的 `getContextItems`，实例只被用来读 `description.title`。这件事是真的，但删或不删不是本计划的范围——本计划只负责让这些代码**不再被静态求值**，为将来的决策留出可测量的余地）。
- 不碰 LLM 双栈（报告 B2）。
- 不碰进程启动路径。
- 不为了让测试变绿放宽任何断言、不加 lint/type suppression。

---

## 三、步骤

### P1 — 给 `embedModelsAreEqual` 一个自己的模块

**改**：新建 `core/indexing/embedModels.ts`，把 `embedModelsAreEqual` 从 `DocsService.ts:93-102` 原样移过去；`CodebaseIndexer.ts:23` 与 `DocsService.ts` 内部的两处调用点（:133、:148）改从新模块引；从 `DocsService.ts` 的导出面移除该函数。

**为什么安全**：函数体只读 `ILLM` 的三个字段，无副作用、无 I/O、无模块级状态，是纯搬移。`CodebaseIndexer` 需要的只是它，不是 `DocsService` 的其余 1000 行。

**验收**

- `npx vitest run indexing/`（core）全绿，`config/` 仍 89 passed / 4 skipped。
- 重建后跑静态链脚本：**第 2 跳不再出现**，puppeteer 从 `service` 闭包里消失（预期 280 → 0）。若没消失，说明还有旁路，**必须停下来把旁路查出来**，不许继续往下做。

**回滚**：`git revert` 单提交即可，无数据、无接口变更（除移除一个导出的函数——若有外部消费者，`grep -rn embedModelsAreEqual` 已确认只有那 4 处）。

---

### P2 — Chromium 爬虫按需加载

**改**：`DocsCrawler.ts:6` 的 `{ ChromiumCrawler, ChromiumInstaller }` 改为在使用点动态 import；`DocsCrawler.ts:28` 构造函数里那句无条件 `new ChromiumInstaller(...)` 改成用到才构造（`shouldUseChromium()` 在其后才判断，本来就不该提前）。`DocsCrawler.ts:101` 的重导出保持可用。

**为什么还要做这一刀**：P1 断的是「为一个纯函数拉整个 docs 子系统」。但只要有人合法地用 docs 索引，`DocsService → DocsCrawler → ChromiumCrawler → puppeteer` 这条边就还在，普通 Cheerio 抓取依然要为 Chromium 买单。P2 让「不需要 JS 渲染的站点」永不求值 Chromium。这也是 P4 那个防回退测试能长期成立的前提。

**验收**

- `npx vitest run indexing/docs/`（含 155 行的 `DocsCrawler.vitest.ts`）全绿。
- 类型检查 exit 0。
- 数字上 P2 不改变 `service` 闭包（P1 已归零），它改变的是 **docs 索引路径自己的闭包**：从 `DocsService` 出发的 `import-statement` 闭包内 puppeteer 应为 0。

**风险**：动态 import 使 `chromiumInstaller` 变为异步取得，调用点若在同步上下文需重排。以测试为准；改不动就停下报告，不硬凑。

---

### P3 — 清掉 9 条冻结泄漏，守卫归零

| 文件                                  | 条数 | 做法                                                     |
| ------------------------------------- | ---- | -------------------------------------------------------- |
| `core/config/yaml/models.ts`          | 2    | `BaseLLM` 是纯类型，改 `import type`；`LLMClasses` 动态  |
| `core/config/yaml/loadYaml.ts`        | 4    | 都在 `configYamlToTntConfig`（已是 async）内，一次性解构 |
| `core/config/profile/doLoadConfig.ts` | 3    | async 上下文，行内 `(await import(...))`                 |

清完后把 `ALLOWED_RUNTIME_IMPORTS` 改回 `[]`。

**为什么这是棘轮的收尾而不是新规则**：守卫现在按真实路径匹配、覆盖 6 个 consumer，但清单里冻结着 9 条既有缺陷（`b6eab560e` 记录为「每条都是待办缺陷，不是许可」）。留着它们，下一个 AI 无法区分「允许」与「待修」。

**验收**：守卫 2 tests 全绿且清单为空；`config/` 89 passed / 4 skipped；`tsc -p core` exit 0。断言不得放宽——如果哪条测试因动态化而红，按上一轮的教训**先查自己改造步骤是否完整**（调用点数是否全改、`it` 回调是否 async、同步 throw 断言是否需要改成 rejection 断言），再怀疑框架。

---

### P4 — 防回退测试（构建后检查产物）

**改**：`packages/cli/e2e/` 新增一个测试，按 `vitest.e2e.config.ts` 的既有做法，读 `build-meta.json` 断言：

- `service-*.js` 的 `import-statement` 闭包内：puppeteer 模块数 = 0、`core/context/providers/` = 0、`core/tools/` = 0、`core/llm/llms/` = 0；
- 入口 `dist/index.js` 的闭包字节 = 844,600 B（进程启动不回退）。

**必须是 e2e 级**：`build-meta.json` 与 `dist/` 都被 gitignore，干净检出上不存在；写成单元测试会在 CI 与本地都以「文件不存在」失败。测试自身要先确认文件存在，并给一句明确的跳过原因（要求先 `npm run build`）。

**断言选图不选大小**：不写「最大 chunk 不得超过 X」——chunk 身份会随边界重划漂移（上一轮实测：改动后最大 chunk 变成了另一个 chunk，且与启动无关）。

---

### P5 — 版本号、推送、CI 修到绿

- `packages/cli/package.json` 版本 1.0.8 → 1.0.9，标记交付产物结构变化。已核：`cli-release.yml` 是 `workflow_dispatch`（要手填版本），`release-*.yml` 只认 **push 到 main** 且按包目录过滤，所以分支推送与 PR **不会发布任何东西**。已核：仓库内没有断言 `1.0.8` 这个字面量的测试。
- 推 `test` 到 `origin`，开 PR → `main`。**不 rebase**：交接文档引用了 `ef73fc6c0` / `b6eab560e` 这些 hash，rebase 会让引用失效（这正是上一轮被批评的自指陷阱）。已核 `test` 与 `origin/main` 文件集零重叠、`git merge-tree` 干净。
- 盯 `CLI PR Checks`（lint、ubuntu/win/mac × node20/22 的测试矩阵含覆盖率地板、smoke、e2e、smoke-api）、`Engine Checks`、`Docs PR Checks`。红了就在 `test` 上修、重推，循环到全绿。

---

## 四、贯穿所有步骤的门禁

每次提交前：core 全量 `vitest`（带 `IGNORE_API_KEY_TESTS=true`）、`packages/cli` 全量 `vitest`、`npm run test:e2e`、两端 `tsc --noEmit`、`eslint`、仓库根 `prettier` 检查改动文件。

`core` 的门禁命令是 `npm run lint`，即 `eslint . --ext ts`，实测 **rc 0（0 errors / 23 warnings）**。裸跑 `npx eslint .` 会额外抓 `.js`，从而报出 11 条 vendored error（`core/vendor/**`、`core/llm/llamaTokenizer.js`），那是既有状态、也不是 CI 用的命令——判断自己有没有引入 lint 问题时，以 `npm run lint` 为准。

改 CLI 产物后必须重建 core 的 `dist`（`cd core && npm run build`），否则 `packages/cli` 的类型门禁读的是 `.d.ts` 旧签名——这是报告 P1-1 的真实复现。

覆盖率地板是 `statements 70 / branches 80 / functions 80`（`packages/cli/vitest.config.ts`）。删代码会动这些数字，CI 的 ubuntu 跑会先撞上，注意别让它因为**分母变化**而红。

---

## 五、执行结果（实测，非计划）

| commit           | 内容                             | 配置路径 eager 闭包         | 其中 puppeteer       |
| ---------------- | -------------------------------- | --------------------------- | -------------------- |
| 基线 `c8672b613` | —                                | 3,806 inputs / 21,138,081 B | 280 模块 / 854,372 B |
| `46a8a555b` P1   | `embedModelsAreEqual` 独立成模块 | 2,479 / 15,319,691          | **0**                |
| `adb21c612` P2   | Chromium 爬虫按需加载            | 2,479 / 15,319,691          | 0                    |
| `3dd291f7c` P3   | 清掉 9 条冻结泄漏，守卫归零      | **1,669 / 14,104,098**      | 0                    |
| `ecfc10ade` P4   | 交付图 e2e 守卫                  | 1,669 / 14,104,098          | 0                    |

**合计 −2,137 inputs（−56%）、−7,033,983 B（−33%）。**

P2 的数字不在配置路径上，而在 **docs 索引路径**自己的闭包：2,547 inputs / 15,711,798 B → 2,073 / 13,649,126 B，其中 puppeteer 由 280 模块 / 854,374 B 归零。它影响的是「配置了 docs 的人抓一个静态站点」，P1 已经把这条路径从配置层摘掉了，所以两个数不能相加。

### 没有变化的东西（必须写清，否则数字会被误读）

- **进程启动闭包全程一字未动**：442 inputs / 844,600 B。这不是启动优化。
- **`dist` 里的 JS 总量几乎没变**：30,760,015 → 30,726,959 B。`splitting: true` 下代码只是换了 chunk，**没有被删除**。改变的是「为了回答一次请求必须先求值什么」，不是「安装包里有什么」。想真正减少交付体积，得走到报告 B3 那一步——把这些模块从 fork 里删掉，那是产品决策，不在本计划范围。

### 与计划的偏离

1. **P4 的锚点换了实现**：计划写「service chunk」，落地按「含 `src/retrieval/service.ts` 的 chunk」定位——实测两者是同一个，但后者不依赖 chunk 大小或命名，chunk 身份会随改动漂移（本会话已两次观察到）。
2. **P3 之后守卫的地板换了机制**：原本指望「非空冻结清单」顺带证明扫描读到了文件；清单归零后这个证明消失了。我先尝试用「文件是否提及注册位」做地板，**变异测试证明它无效**——`llm/index.ts` 本身就在 `core/llm` 子树内，它对自身目录的任何导入都算提及，永远非零。改成逐文件字节地板（>1,000，最小者 3,562，有余量）。两条变异都验过：重新加一条 eager import → 泄漏测试红；把某个 consumer 换成小桩 → 地板红。
3. **P4 额外加了「闭包非空」断言**（两个闭包各 >100 inputs）：否则锚点查找失败会得出空集，空集满足所有「应当为空」的断言。

### 配置路径闭包里剩下的是什么（不是泄漏，别去切）

`core/context/providers/utils.ts`（被 `context/retrieval/retrieval.ts` 取一个常量）、`core/context/providers/URLContextProvider.ts`（被 `tools/implementations/fetchUrlContent.ts` 取 `getUrlContextItems` 函数）、`context/mcp/MCPConnection|MCPOauth`、`core/tools/` 下 29 个模块。都是**被真实调用**的代码，且守卫的 barrel 规则不把它们算作注册表。合计 ctx 12 模块 / 25,104 B、tools 29 模块 / 23,066 B。

### 本轮门禁最终状态

| 门禁                                         | 结果                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| core `vitest`（`IGNORE_API_KEY_TESTS=true`） | 146 files / 2,225 tests passed（+1 文件 +4 用例来自 P2）                                                                                                     |
| packages/cli `vitest`                        | 466 files / 3,764 tests passed                                                                                                                               |
| `test:e2e`                                   | **35 files / 123 tests passed**（+1 文件 +3 用例来自 P4）                                                                                                    |
| `tsc` core / packages/cli                    | exit 0 / exit 0                                                                                                                                              |
| `eslint .` packages/cli                      | 0 problems                                                                                                                                                   |
| `eslint .` core                              | CI 用的 `npm run lint`（`eslint . --ext ts`）rc 0：0 errors / 23 warnings。裸跑 `npx eslint .` 会多抓 `.js`，报 11 条 vendored error，属既有状态且非门禁命令 |
| `prettier --check`（仓库根二进制）           | 全部改动文件通过                                                                                                                                             |

### 顺带发现的两处既有问题（未修，供后续判断）

1. `core/config/profile/LocalProfileLoader.vitest.ts:15` 的 mock 有 TDZ 缺陷，运行时会打 `Cannot access 'mockDoLoadConfig' before initialization`，但**测试仍然通过**——它落入配置加载的错误处理里了。该现象在本轮任何改动之前就存在（已对最早的 core 全量日志核过）。
2. `core/indexing/docs/crawlers/DocsCrawler.vitest.ts` **整套位于 `describe.skip`**（要抓真实站点并下载 Chromium）。所以 P2 改的是一条原本无自动化覆盖的路径，P2 为此补了 4 个离线用例。
