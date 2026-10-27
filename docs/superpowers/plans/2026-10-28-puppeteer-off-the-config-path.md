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

每次提交前：core 全量 `vitest`（带 `IGNORE_API_KEY_TESTS=true`）、`packages/cli` 全量 `vitest`、`npm run test:e2e`、两端 `tsc --noEmit`、`eslint`（core 有 11 条 vendored 既有 error，判定标准是「本次文件是否新增」）、仓库根 `prettier` 检查改动文件。

改 CLI 产物后必须重建 core 的 `dist`（`cd core && npm run build`），否则 `packages/cli` 的类型门禁读的是 `.d.ts` 旧签名——这是报告 P1-1 的真实复现。

覆盖率地板是 `statements 70 / branches 80 / functions 80`（`packages/cli/vitest.config.ts`）。删代码会动这些数字，CI 的 ubuntu 跑会先撞上，注意别让它因为**分母变化**而红。
