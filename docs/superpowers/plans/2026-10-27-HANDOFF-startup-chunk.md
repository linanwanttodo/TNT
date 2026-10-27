# HANDOFF — CLI 启动包体收敛（下一步从这里开始）

> **状态**：进行中，分支为绿，剩余工作已精确定位但未开始。
> **读者**：下一个接手的人或 agent。本文自包含，读完后不需要重新调研任何东西。
> **下一步只有一件事**：解开第 5 节的 blocker，然后做完第 4 节的 43 KB。

---

## 1. 结论摘要（TL;DR）

一件事做成了，一件事被 blocker 挡住。

| | 内容 | 结果 |
| --- | --- | --- |
| ✅ 已完成 | `core/config/load.ts` 的 9 处注册表导入改为惰性 | 主启动 chunk **16.3 MB → 8.9 MB（−45%）**，启动时少求值 **558 个模块** |
| 🚫 受阻 | `load.ts → loadContextProviders.ts` 的静态边（剩余约 43 KB） | 改动本身正确且 tsc 通过，但**恰好 3 个既有测试会红**，根因是 `vi.mock` 拦不住动态 `import()`；需要 owner 同意改写这 3 条断言 |

三条**被证伪的假设**（第 3 节）比已完成的收益更重要：它们解释了为什么上一轮一度得出「改了等于没改」的错误结论，重复一次会白丢掉一整轮时间。

---

## 2. 环境：先跑这三条命令

另一个 agent 同时在 `dev/p0-hardening` 上工作，所以本任务在**独立 worktree** 里做。**不要在共享检出上切分支** —— 那会把对方正在做的改动一起切走。

| 项 | 值 |
| --- | --- |
| 共享检出（**另一个 agent，绝对不要动**） | `/home/lin/All_projects/GithubProjects/continue` on `dev/p0-hardening` |
| 本任务工作区 | `/home/lin/All_projects/GithubProjects/continue/.vitest/worktree` on `test` |
| 分支顶端 | `8cc2156c8` ← `eac717d5f`（惰性化 + 守卫） ← `3f052c652`（计划） ← `e532b4971`（= `origin/main`） |

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree
git log --oneline -3        # 应为 8cc2156c8 / eac717d5f / 3f052c652
git status --short          # 应为空
```

### 为什么工作区在 `.vitest/` 下

`.vitest/` 已被 `.gitignore`、`.prettierignore`、CLI 的 `eslint.config.js` **三处**忽略，所以在这个目录里放一个完整检出不需要修改任何共享配置文件 —— 这是为了不和另一个 agent 抢文件。**改动的文件本身在 worktree 内是正常路径**，只有 worktree 容器目录被忽略。

### 两条禁令

1. **不要在这个工作区跑 `npm install`。** 依赖是硬链接到共享检出的：npm 安装会就地改写被硬链接的文件，从而**污染另一个 agent 的工作区**。
2. **不要在共享检出里执行 git 操作**（checkout / stash / commit / worktree remove）。全部在 worktree 内做。

`dist/` 是真实拷贝而不是链接，所以重新构建、跑测量都是安全的。

### 清理（做完后再执行，对应上面的禁令 2）

```bash
cd /home/lin/All_projects/GithubProjects/continue
git worktree remove .vitest/worktree --force
git branch -D test          # 只有在工作已合并或确认丢弃时
```

---

## 3. 三条被证伪的假设（不要重复）

### 3.1 「泄漏只有 2 个文件 9 处」—— 错了

实际是 **5 个文件 20 处**：

| 文件 | 处数 |
| --- | --- |
| `core/config/load.ts` | 9（已在本分支惰性化） |
| `core/config/loadContextProviders.ts` | 8（**未做，见第 4 节**） |
| `core/config/yaml/loadYaml.ts` | 4 |
| `core/config/doLoadConfig.ts` | 2 |
| `core/config/yaml/models.ts` | 2 |

**连带后果：** 守卫 `core/staticImportBoundary.vitest.ts` 的 `consumers` 列表必须覆盖全部 6 个文件（含 `core/llm/index.ts`），并且匹配必须**按 `path.resolve` 的真实路径**做，而不是字符串前后缀比较 —— 字符串比较对 `../tools` 与 `../../tools` 是深度敏感的，会**静默漏报**（守卫通过但边还在）。

### 3.2 「用 sourcemap 的 source 计数衡量包体」—— 错了

`packages/cli/build.mjs` 开了 `splitting: true`：被延迟的代码**仍然在 `dist/` 里**，只是进了独立 chunk。所以「`dist/*.js.map` 里 source 的并集」永远是 306 个，永远不会下降 —— 它衡量的是「dist 里有什么」，不是「启动时加载什么」。

我因此一度报告「16.3 MB → 16.3 MB，零收益」，并差点放弃了一个实际减半的改动。

**唯一有效指标是 esbuild metafile 的 chunk 归属。** 指标的选取必须与改动的作用机制对齐。

### 3.3 「`DocsService → TransformersJsEmbeddingsProvider` 是启动路径上的 eager 边」—— 错了

`core/indexing/docs/DocsService.ts:171` 确实是一处 eager 泄漏，而且形式比预期隐蔽 —— 不是 import，而是一个**静态字段初始化器**（模块加载即求值），会拖入 vendored 的 transformers 运行时：

```ts
static defaultEmbeddingsProvider = new TransformersJsEmbeddingsProvider();
```

我把它改成惰性访问器（`getEmbeddingsProvider()` 本来就是 async，调用点加 `await` 即可），tsc 通过。**但重建后主 chunk 8,889,443 → 8,889,637 B（+194 B，等于没变）**，因此没有提交。

原因：整条 retrieval 子树是经 **`dynamic-import`** 进入的（`codebaseSearch.ts --dynamic-import--> retrieval/service.ts`），所以 `DocsService` 本来就在按需 chunk 里，从来不在启动 chunk 内。

> 这个改动对**按需 chunk 的首次使用耗时**是真实改进，只是对启动指标零收益。如果将来要优化「第一次搜索的延迟」，它值得重新捡起来。

---

## 4. 下一步：剩余的唯一启动收益（约 43 KB）

主 service chunk 里仍残留 `ctx=43,364` + `tools=14,661` 字节。根因已确认，是一条静态边：

```
core/config/load.ts  --import-statement-->  ./loadContextProviders.ts
  --> ../context/providers        （桶文件，导出全部 44 个 provider）
  --> 7 个具体 provider 模块
```

`core/config/load.ts` 第 56 行仍静态导入 `loadContextProviders`，而后者静态导入 8 处。

### 改法（已写过一遍并验证正确，只是被第 5 节的 blocker 挡住）

1. 把 `loadConfigContextProviders` 改成 `async`，顶部用 `await Promise.all([...])` 解构出**同样 8 个绑定**，函数体完全不动。
2. 加 `await` 的调用点（共 3 组）：
   - `core/config/load.ts` 约第 434 行。注意源码里是
     ```
     ...
     = 
         loadConfigContextProviders(
     ```
     `=` 在上一行，所以按整行替换 `    loadConfigContextProviders(` → `    await loadConfigContextProviders(` 更稳。
   - `core/config/yaml/loadYaml.ts` 约第 364 行，同样处理。
   - `core/config/loadContextProviders.vitest.ts` 的 **16 个调用点**：
     ```bash
     sed -i 's/= loadConfigContextProviders(/= await loadConfigContextProviders(/g' \
       core/config/loadContextProviders.vitest.ts
     sed -i 's/, () => {$/, async () => {/' core/config/loadContextProviders.vitest.ts
     ```
     （第二条把 `it(...)` 回调改成 `async`；改完必须 `npx prettier --write`。）

### 验收标准（三条都要给证据）

```bash
npx vitest run config/        # 全绿（改动前基线：89 passed / 4 skipped）
npx tsc -p ./ --noEmit        # exit 0
```

第三条是**重建后的包体测量**：用第 6 节的脚本，确认主 chunk 的 `ctx=` 显著下降或归零。

---

## 5. Blocker：恰好 3 个测试会红，需要 owner 拍板

改完后只有这 3 个测试失败（`core/config/loadContextProviders.vitest.ts`）：

```
FAIL  edge cases > should handle provider constructor throwing error
FAIL  provider instantiation > should call default provider constructors with empty options
FAIL  provider instantiation > should call provider constructors exactly once per provider
→ expected "spy" to be called 1 times, but got 0 times
```

**根因（已确诊，不是猜测）：** 这 3 个测试用 `vi.mock("<path>", () => ({ default: vi.fn()... }))` 工厂，并断言 mock 构造函数的**调用次数**。`vi.mock` 的工厂**无法拦截动态 `import()`** —— 静态 import 会被提升并在模块加载时装配，动态 import 走运行时解析，拿不到工厂替换后的模块身份。所以 spy 调用次数恒为 0。

**为什么上一轮没有直接改：** 这 3 条断言的对象是**实现细节（构造函数被调用几次）**，不是可观察行为。改成断言可观察行为会让覆盖更强，但那**改变了被断言的对象**，属于需要 owner 拍板的决定。按仓库规则不能为了让测试变绿而放宽断言，所以当时选择回滚、保住绿分支。

**建议的改法（待 owner 同意后执行）：** 断言返回值而不是 spy：

- `providers.map(p => p.description.title)` 应等于预期的默认 provider 标题列表
- `errors` 的内容与顺序
- 未知 provider 名时的降级行为

**注意两个细节：**

1. `ProblemsContextProvider` 与 `TerminalContextProvider` 的 mock 额外挂了 `description` 属性 —— 改写断言时要保留，否则会因 `description` 缺失而挂。
2. JetBrains 分支会**排除** problems / terminal 两个 provider，断言标题列表时必须覆盖这个分支。

---

## 6. 复现测量（重建 + 读 metafile）

临时脚本已删，重建即可：

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree
npm run build --workspace packages/cli     # 生成 packages/cli/dist + build-meta.json
```

然后读 `packages/cli/build-meta.json`：

- 对每个 `outputs["*.js"]`，累加其 `inputs[*].bytesInOutput` 得到 chunk 大小 —— **找出最大的那个 chunk，它就是启动 chunk**。
- 在同一 chunk 内，统计来源路径含 `/core/llm/llms/`、`/core/context/`、`/core/tools/` 的字节数。**这三个数就是要压到 0 的目标**（当前 `ctx=43,364`、`tools=14,661`、`llms=0`）。

上一轮实测：

| 指标 | BEFORE `3f052c652` | AFTER `eac717d5f` |
| --- | --- | --- |
| 主 service chunk | 16,256,904 B | **8,889,443 B（−45%）** |
| 启动时求值的模块数 | 1,981 | **1,423（−558）** |
| provider 代码（115,562 B） | 在主 chunk 内 | 移入按需 chunk `llms-*.js`（111,742 B） |

---

## 7. 剩余项（优先级低于第 4/5 节）

1. **`llm/index.ts` 的 `../tools/applyToolOverrides.js`：不需要改。** 它是叶子模块（只 import `@tnt/config-yaml` 和一个类型模块），守卫按设计不报它。不要为了「消灭告警」去动它。
2. **`models.ts`**：`BaseLLM` 改成 `import type` 即可（纯类型，不产生运行时边）。
3. **`loadYaml.ts` 的 4 处**：都在 `configYamlToTntConfig`（async）里，可以一次性解构。
4. **`doLoadConfig.ts` 的 2 处**：在 async 上下文里，可用行内 `(await import(...))`，不必提前解构。
5. **给启动包体加守卫（防回退）**：用 metafile 断言 provider/context 代码不出现在主 service chunk。
   ⚠️ **`build-meta.json` 是构建产物且被 gitignore**，所以这**必须**是一个「先构建再检查」的 e2e 级测试（参考 `e2e/` 与 `vitest.e2e.config.ts` 的既有做法），**不能**写成普通单元测试 —— 否则在干净检出上会因文件不存在而失败。
6. **修正计划文档的度量指标**：`docs/superpowers/plans/2026-10-27-cli-core-boundary-and-hardening.md` 的 2.2 节仍写着「9 行 / 2 个文件 / 用 sourcemap 计数」，已被第 3 节证伪。应改成「20 处 / 5 个文件 / 用 metafile 的 chunk 归属」，并补一句为什么 sourcemap 计数会得出零收益。

---

## 8. 尚未验证的东西（必须如实交接，不要当成已验证）

| 项 | 状态 |
| --- | --- |
| `config/` 子集测试（89 passed / 4 skipped） | ✅ 跑过 |
| 边界守卫 `core/staticImportBoundary.vitest.ts`（2 tests） | ✅ 跑过 |
| `npx tsc -p core` | ✅ exit 0 |
| **CLI 全量 vitest（约 505 个文件）** | ❌ **从未在本分支跑过** |
| **`npm run test:e2e`** | ❌ **从未在本分支跑过** |
| **端到端真实调用一个模型** | ❌ 未做（无 provider key） |

所以本分支的「绿」只覆盖 `config/` 子树与类型检查。**合并前必须补跑 CLI 全量测试与 e2e。**

关于惰性化本身：行为验证来自四条证据 —— 单元测试、类型检查、重建后 CLI 的 `config/` 全量测试、以及构建产物里 chunk 归属的实测。**没有**端到端调用真实模型的验证，所以不要把 `eac717d5f` 描述成「已验证运行时行为」。

---

## 9. 本仓库的硬性规则（会被 CI / 守卫卡住）

- **每个 commit 前四项全绿**：`npx vitest run`、`npx tsc --noEmit`、`npx eslint .`、`npx prettier --check "src/**/*.{ts,tsx}" "test-utils/**/*.{ts,tsx}"`。prettier 要用**仓库根**的二进制（worktree 内没有独立的 `node_modules/.bin`）。
- **Conventional commits**；commit message 里**不出现其他产品名**；本仓库最近 60 个 commit 都没有 AI 署名行，所以**不要加** co-author 或 "Generated with" 尾巴。
- **不要为了让测试变绿而放宽断言、跳过测试或加 lint/type suppression。** 这是上一轮宁可回滚也不改那 3 条断言的原因。
- **守卫以「棘轮」形式落地**：先冻结一份当前清单，之后新增即失败。不要在首次引入时就把目标写成「零泄漏」——那会让守卫从一开始就是红的。
- **文件超过 ESLint 上限时拆分文件**，不要往 `packages/cli/eslint.config.js` 的豁免清单里加新名字。
- 新增行为要有测试；文档里不要写未经验证的行为（第 8 节的存在就是因为这条）。
- 运行时行为变更要走「issue + `docs/superpowers/plans/` 里的计划」这条路，本任务的计划文档即 `2026-10-27-cli-core-boundary-and-hardening.md`。

---

## 10. 交接时的仓库实际状态

| 项 | 状态 |
| --- | --- |
| `test` 分支 | **干净**，3 个 commit：`3f052c652`、`eac717d5f`、`8cc2156c8`（本文） |
| 共享检出 `dev/p0-hardening` | 在 `3c2b598ef`；`core/` 与 `docs/` **零改动** —— 本任务全程未触碰它 |
| 共享检出里的未提交改动 | `packages/cli/src/{index.ts,commands/BaseCommandOptions.ts,config/sharedOptions.ts,i18n/index.ts,i18n/untranslatedOutput.test.ts}` + 未跟踪的 `packages/cli/e2e/headless-prompt-source.test.ts` —— **这是另一个 agent 的在途工作，不是本任务的，不要提交、不要碰** |
