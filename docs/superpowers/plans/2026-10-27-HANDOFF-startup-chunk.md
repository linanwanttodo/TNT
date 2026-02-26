# HANDOFF — CLI/core 包体边界（§4 已完成，剩余在 §7）

> **状态**：分支为绿。上一轮交下来的两件事都做完了，其中一件的根因是误诊。
> **读者**：下一个接手的人或 agent。本文自包含，所有数字都在 worktree 里复算过。
> **文件名里的 `startup-chunk` 是上一轮的框定，已被 §3.5 推翻**：这条路径不在进程启动上。

---

## 1. 结论摘要（TL;DR）

|           | 内容                                                               | 结果                                                                                                  |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| ✅ 已完成 | `loadContextProviders.ts` 的 8 处注册表导入改为惰性（`ef73fc6c0`） | 配置路径的 eager 图 **少 646 个 input（4,452 → 3,806）**，service chunk 里的 provider 模块 **31 → 0** |
| ✅ 已完成 | 边界守卫扩到 6 个 consumers 并改按真实路径匹配（`b6eab560e`）      | 深层消费者经 `../../tools` 的泄漏第一次被看见；9 条既有泄漏冻结为棘轮                                 |
| 🚫 已撤销 | 上一轮记录的 blocker「`vi.mock` 拦不住动态 `import()`」            | **误诊**。断言一条都没改，19 个测试全绿，不需要 owner 拍板（见 §3.4）                                 |
| ⚠️ 已修正 | 上一轮的「主启动 chunk −45%」指标                                  | 那个 chunk 只被 `dynamic-import` 边引用，**从来不在启动路径上**（见 §3.5、§6）                        |

一句话：**这件事的真实收益不是「启动变快」，而是「配置路径的静态依赖图变小 + 边界从此有守卫」。** 进程启动实测前后都是 0.09 s，没有变化，也不该有。

---

## 2. 环境：先跑这两条命令

| 项                                     | 值                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 共享检出（另一个任务在用，**不要动**） | `/home/lin/All_projects/GithubProjects/continue` on `dev/p0-hardening`（`c94fced7f`）                                                    |
| 本任务工作区                           | `/home/lin/All_projects/GithubProjects/continue/.vitest/worktree` on `test`                                                              |
| 分支顶端                               | 本轮所有 commit 都在 `928a62920..test` 这个区间里（含本文自己），用 `git log --oneline 928a62920..test` 核对。别把某个 hash 抄成永久顶端 |

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree
git log --oneline 928a62920..test   # 本轮的全部 commit
git status --short                  # 应为空
```

上一轮本文里的两个 hash 已经失效，别照着核：`8cc2156c8` 是个孤儿提交（旧版 97 行文档，后来重写成 `928a62920`）；`e532b4971` 当时等于 `origin/main`，现在 `origin/main` 是 `3c2b598ef`。它列在共享检出里的「在途未提交改动」也已经被提交成 `c94fced7f`。

### 为什么工作区在 `.vitest/` 下

`.vitest/` 被 `.gitignore:191`、`.prettierignore:19`、`packages/cli/eslint.config.js:218` 三处忽略，所以在里面放一个完整检出不需要改任何共享配置。**被修改的文件本身在 worktree 内是正常路径**，只有容器目录被忽略。

### 两条禁令

1. **不要在这个工作区跑 `npm install`。** 依赖硬链接到共享检出，npm 会就地改写被硬链接的文件，污染另一个工作区。
2. **不要在共享检出里执行 git 操作**（checkout / stash / commit / worktree remove）。全部在 worktree 内做。

`dist/` 是真实拷贝，重建安全。

### 构建命令（上一轮写错了）

```bash
npm run build --workspace packages/cli     # ✗ 根 package.json 没有 workspaces 字段，直接报错
cd packages/cli && npm run build           # ✓
cd core && npm run build                   # 只在需要刷新 core/dist/*.d.ts 时跑（CLI 的 tsc 走 tsconfig paths 读它）
```

CLI 的 bundle 经 `build.mjs` 的 `core: ../../core` 别名**直接编译 core 源码**，所以改完 core 不必先构建 core 就能测包体。

### 清理（整批合并后）

```bash
cd /home/lin/All_projects/GithubProjects/continue
git worktree remove .vitest/worktree --force
git branch -D test
```

---

## 3. 被证伪的假设（不要重复）

### 3.1 「泄漏只有 2 个文件 9 处」—— 错了

实际 **25 处 / 5 个文件**（上一轮标题写 20，与自己给的表格相加不符）：

| 文件                                  | 处数              | 状态                                                                    |
| ------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| `core/config/load.ts`                 | 9                 | 上一轮已惰性化                                                          |
| `core/config/loadContextProviders.ts` | 8                 | **本轮已惰性化**                                                        |
| `core/config/yaml/loadYaml.ts`        | 4                 | 未做（§7.2）                                                            |
| `core/config/profile/doLoadConfig.ts` | 5（按守卫口径 3） | 未做（§7.3）——上一轮写成 `core/config/doLoadConfig.ts`，少了 `profile/` |
| `core/config/yaml/models.ts`          | 2                 | 未做（§7.1，纯类型，最便宜）                                            |

**顺带一处计数错误**：上一轮 §4 说 barrel「导出全部 44 个 provider」。`core/context/**` 确实有 44 个 `.ts`，但 `core/context/providers/index.ts` 只导入并导出 **29 个** provider 模块（`Providers` 数组 29 项）。守卫注释与包体描述都按 29 记账。

**连带后果已在本轮落地**：守卫 `core/staticImportBoundary.vitest.ts` 读全部 6 个 consumers（含 `core/llm/index.ts`），并且按 `path.resolve` 的真实路径匹配。字符串比较对 `../tools` 与 `../../tools` 深度敏感，会**静默漏报**——守卫通过但边还在。改之前这条正是漏的：`doLoadConfig.ts` 的 3 条从未被任何检查看见。

### 3.2 「用 sourcemap 的 source 计数衡量包体」—— 错了

`packages/cli/build.mjs` 开了 `splitting: true`：被延迟的代码**仍然在 `dist/` 里**，只是进了独立 chunk。所以「`dist/*.js.map` 里 source 的并集」恒为 306，永远不降——它衡量「dist 里有什么」，不是「哪条路径要加载什么」。

### 3.3 「`DocsService → TransformersJsEmbeddingsProvider` 在启动路径上」—— 错了

`core/indexing/docs/DocsService.ts:171` 是一处真实的 eager 泄漏，而且形式隐蔽——不是 import，是**静态字段初始化器**（模块加载即求值）：

```ts
static defaultEmbeddingsProvider = new TransformersJsEmbeddingsProvider();
```

改成惰性访问器后 tsc 通过，但重建后主 chunk 8,889,443 → 8,889,637 B（+194 B），所以没提交。整条 retrieval 子树是经 `dynamic-import` 进入的，`DocsService` 本来就不在主 chunk 里。这个改动对**首次搜索**是真实改进，将来优化首搜延迟时值得捡起来。

> ⚠️ 上一轮遗留在 worktree 里的 `build-meta.json` 就是这次未提交实验的产物（8,889,637）。本轮已重建，现在它对应 `HEAD`。

### 3.4 「`vi.mock` 的工厂拦不住动态 `import()`」—— 错了，这是上一轮 blocker 的假根因

上一轮记录：改完后 3 个测试红，报 `expected "spy" to be called 1 times, but got 0 times`，于是判定动态 import 绕过了 mock，需要 owner 同意改写断言。**实测不是这样。**

真因是上一轮自己给的 sed 不完整：`s/= loadConfigContextProviders(/.../g` 只命中 **16** 处，而调用点有 **19** 处（全仓 21 处）。漏掉的 3 处是

- `loadContextProviders.vitest.ts:505` 的 `expect(() => loadConfigContextProviders(...)).toThrow(...)`（没有 `=`），
- `:570` 与 `:581` 两处**裸语句调用**（赋值号都没有）。

函数变 async 后这 3 处没被 await，断言在函数体执行前就跑完了，spy 自然恒为 0。反向证据也直接：那次失败的栈里 `Provider construction failed` 走到了 `loadContextProviders.ts` 内部，说明 barrel 的动态 import **确实被 mock 替换了**。

处理办法：`:505` 改成 `await expect(...).rejects.toThrow(...)`，两处裸调用补 `await`。结果 **19 passed**，`vitest run config/` **89 passed / 4 skipped** 与改动前基线一致，`tsc -p core` exit 0。断言一条没放宽。

> 教训：**「测试变红」先怀疑自己的改造步骤是否完整，再归因到框架能力。** 上一轮把 sed 的漏网之鱼诊断成了 Vitest 的限制，据此搁置了一整轮并向上游要了一个本不存在的决定。

### 3.5 「最大的那个 chunk 就是启动 chunk」—— 错了，而且和 §3.2 是同一类错误

`packages/cli` 的 `bin.tnt = dist/tnt.js` 是 122 B 的壳：

```js
const { runCli } = await import("./index.js");
```

`dist/index.js` 再经 `import-statement` 边拉起 14 个 chunk。**进程启动的真实 eager 闭包 = 844,600 B / 442 个 input，里面 `core/context`、`core/tools`、`core/llm/llms` 全为 0**，改动前后一字不差。

那个 8.9 MB 的 `service-*.js` 只被 `--dynamic-import-->` 引用，是 **retrieval service 的 chunk**（`packages/cli/src/retrieval/service.ts` 是全仓唯一 import `ConfigHandler` 的文件），由 `codebaseSearch` 工具和 `@codebaseIndex` 命令按需拉起。它从来不是启动 chunk。上一轮表里的「启动时求值 1,423 个模块」其实就是这个 chunk 自己的 input 数（1423），被当成了启动模块数——真值是 442。

**指标必须与改动的作用机制对齐，而且要对「谁是入口」取证，不能靠 chunk 大小猜。** 数据源选 metafile 是对的，选错了被测量的对象还是错的。

---

## 4. 本轮做完的：`loadContextProviders.ts` 惰性化

改法（`ef73fc6c0`）：

1. 8 处静态注册表导入换成函数体内一次 `await Promise.all([...])`，解构出同样的 8 个绑定（barrel 取具名导出，其余取 `default`）。函数体其余部分一字未动。
2. 签名 `export function` → `export async function`，返回类型 `Promise<{...}>`。
3. **21 个调用点**全部 await：
   - `core/config/load.ts:434`（注意源码里 `=` 在上一行，按整行替换更稳）
   - `core/config/yaml/loadYaml.ts:352`
   - `core/config/loadContextProviders.vitest.ts` 的 19 处：16 处 `= load...` 加 await；`:505` 改成 rejection 断言；`:570`/`:581` 两处裸调用加 await。
   - 19 个 `it(...)` 回调改成 `async`，**`describe` 不要动**（上一轮的 sed `s/, () => {$/, async () => {/` 会把 `describe` 一起改掉）。改完 `prettier --write`。

没有引入模块级 promise 缓存：这里只有一个函数用它，`import()` 本身已被加载器记忆；`load.ts` 那种缓存在它有 9 个使用点时才划算。

### 验收标准（三条都有证据，见 §8）

```bash
cd core && npx vitest run config/     # 89 passed / 4 skipped
cd core && npx tsc -p ./ --noEmit     # exit 0
cd packages/cli && npm run build      # 重建后用 §6 的脚本复算
```

---

## 5. 本轮做完的：守卫改成按真实路径匹配

`core/staticImportBoundary.vitest.ts`（`b6eab560e`）：

- `CONSUMERS`（:83）= 6 个文件：`config/load.ts`、`config/loadContextProviders.ts`、`config/yaml/loadYaml.ts`、`config/yaml/models.ts`、`config/profile/doLoadConfig.ts`、`llm/index.ts`。
- 匹配方式（:48）：把 specifier 相对**导入方所在目录** `path.resolve`，再与注册表根的绝对路径比较，彻底去掉深度敏感。
- 语义保持原样：`tools` 只精确匹配 barrel（`core/tools/index.ts`），`llm`、`context/mcp`、`context/providers` 按子树匹配。`core/tools/applyToolOverrides.ts` 是叶子，按设计不报。
- 新增规则：注册表内部互相引用不算「配置层把注册表拉进来」（`llm/index.ts` 引 `./llms` 不该报），只有活在子树外的导入方才被测。
- 用整语句解析取代原来的单行扫描：多行 `import {\n  type A,\n} from "../llm"` 是免费的，旧写法的 `inTypeBlock` 分支实际是死代码，会把这种语句误记为运行期导入。

### 变异测试（守卫绿不等于守卫在测东西）

| 变异                                                                                | 期望 | 实测                           |
| ----------------------------------------------------------------------------------- | ---- | ------------------------------ |
| 给 `loadContextProviders.ts` 加 `import { getBaseToolDefinitions } from "../tools"` | 红   | 红 ✓                           |
| 给 `models.ts` 加 `import ... from "../../context/providers"`（深层路径）           | 红   | 红 ✓（旧字符串版本会静默放过） |
| 加多行 `import { type Foo } from "../context/providers"`                            | 绿   | 绿 ✓                           |
| 加多行 `import { type Foo, Bar } from "../context/providers"`                       | 红   | 红 ✓                           |

冻结清单 `ALLOWED_RUNTIME_IMPORTS`（:71）有 9 条非空，所以「一个文件都读不到」的扫描会得出空集而不是匹配清单——**静默失效会失败**，不需要额外的地板断言。另外两个已清零的文件由地板断言守住（检查它们仍含 `import("../context/providers…"` 的动态形态）。

---

## 6. 度量：三条都要看

读 `packages/cli/build-meta.json`（esbuild metafile；它是构建产物且被 `.gitignore:195` 忽略）。

```js
// 1) 进程启动的真实代价：入口的 import-statement 闭包
//    dist/tnt.js 是壳，入口 chunk 是 dist/index.js
// 2) service chunk 自身字节
// 3) 配置路径的 eager 闭包：从 service chunk 出发的 import-statement 闭包
```

本轮实测（HEAD `928a62920` → 改动后）：

| 指标                             | 改动前                     | 改动后                         | 说明                                          |
| -------------------------------- | -------------------------- | ------------------------------ | --------------------------------------------- |
| 进程启动 eager 闭包              | 844,600 B / 442 input      | **844,600 B / 442 input**      | 一字不差；ctx/tools/llms 两边都是 0           |
| `tnt --version` 墙钟             | 0.09 s                     | 0.09–0.10 s                    | 无变化                                        |
| service chunk 自身               | 8,889,443 B                | **73,892 B**                   | −99.2%，但这是 chunk 边界重划，别单独引用     |
| service chunk 内 provider 模块数 | 31                         | **0**                          | 本轮的目标                                    |
| **配置路径 eager 闭包**          | 23,332,822 B / 4,452 input | **21,138,081 B / 3,806 input** | **−2,194,741 B / −646 input，这才是本轮收益** |
| 配置路径闭包内 `core/context/*`  | 60,798 B                   | 30,330 B                       | 剩下的 30 KB 来自 §7 未做的 `context/mcp`     |
| 新增按需 chunk `providers-*.js`  | —                          | 2,007,385 B / 533 input        | 由 service chunk `--dynamic-import-->`        |

上一轮表格里的「16.3 MB → 8.9 MB（−45%）」对 `service` chunk 自身是**可复现的真实数字**（`eac717d5f` 确实把它减半了），只是它测的不是启动。引用时必须配一句「这个 chunk 按需加载」。

---

## 7. 剩余项

1. **`yaml/models.ts` 的 `BaseLLM`**：改成 `import type` 即可（纯类型，不产生运行时边）。守卫已把它记在冻结清单里，改完删那一行即可。
2. **`yaml/loadYaml.ts` 的 4 条**：都在 `configYamlToTntConfig`（已是 async）里，可以一次性解构。
3. **`profile/doLoadConfig.ts` 的 3 条**（守卫口径）：同在 async 上下文，可用行内 `(await import(...))`。
4. **`llm/index.ts` 的 `../tools/applyToolOverrides.js`：不需要改。** 叶子模块，守卫按设计不报它。不要为了「消灭告警」去动它。
5. **给包体加防回退守卫**：用 metafile 断言 provider/context 代码不出现在 service chunk。
   ⚠️ `build-meta.json` 是构建产物且被 gitignore，所以这**必须**是「先构建再检查」的 e2e 级测试（参考 `packages/cli/e2e/` 与 `vitest.e2e.config.ts`），**不能**写成普通单元测试——干净检出上没有这个文件。
   ⚠️ 断言对象选 §6 的第 3 行（配置路径 eager 闭包），不要选「最大 chunk」，后者身份会随改动漂移（本轮改动后最大 chunk 就变成了 `chunk-OIMSHNAI.js`）。
6. **`DocsService.ts:171` 的静态字段初始化器**：见 §3.3，对首搜有价值，对包体指标无价值。

---

## 8. 验证状态（本轮全跑，含上一轮没跑的两项）

| 项                                        | 结果                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core` 全量 vitest                        | ✅ 145 files passed / 10 skipped；2,221 tests passed。**需要 `IGNORE_API_KEY_TESTS=true`**                                                                                   |
| ├─ 不带该变量时                           | ⚠️ `core/llm/llm.vitest.ts` 19 个用例红：打真实 API，缺 `ANTHROPIC_API_KEY` 等。环境前置条件，非回归（门控在 `llm.vitest.ts:207`）                                           |
| `core/config/` 子集                       | ✅ 89 passed / 4 skipped（与改动前基线一致）                                                                                                                                 |
| 边界守卫 `staticImportBoundary.vitest.ts` | ✅ 2 passed，另做 4 项变异测试（§5）                                                                                                                                         |
| `packages/cli` 全量 vitest                | ✅ **466 files / 3,764 tests 全绿**（上一轮从未跑过，本轮补上）                                                                                                              |
| `npm run test:e2e`                        | ✅ **34 files / 120 tests 全绿**（上一轮从未跑过，本轮补上）                                                                                                                 |
| `tsc --noEmit`                            | ✅ core exit 0；packages/cli exit 0（需 `cd core && npm run build` 刷新 dist 的 `.d.ts`，CLI 经 tsconfig paths 读它）                                                        |
| `eslint .`                                | ⚠️ core 报 11 errors + 18 warnings，**全部在 `core/vendor/**` 与 `core/llm/llamaTokenizer.js`**，vendored 代码，与本次改动无关；本次 5 个改动文件 0 error。packages/cli 全清 |
| `prettier --check`                        | ✅ 本次 5 个文件全清（要用**仓库根**的 `./node_modules/.bin/prettier`，worktree 内没有独立 `.bin`）                                                                          |
| 端到端真实调用一个模型                    | ❌ 仍未做（无 provider key）。所以不要把本轮描述成「验证过真实模型运行时行为」                                                                                               |

行为验证来自：单元/全量测试、类型检查、构建产物的 chunk 归属、以及对守卫做的人工变异。**进程启动时间没有变化，也不应该有**——见 §3.5。

---

## 9. 本仓库的硬性规则（会被 CI / 守卫卡住）

- **每个 commit 前四项全绿**：`npx vitest run`（core 与 packages/cli 都要，且 core 要带 `IGNORE_API_KEY_TESTS=true`）、`npx tsc --noEmit`、`npx eslint .`、`npx prettier --check`。注意 `eslint .` 在 core 上本来就有 vendored 报错，判断标准是「本次改动文件是否新增」。
- **Conventional commits**；commit message 里不出现其他产品名；最近 300 个 commit 冒号后全是英文且无 AI 署名行，沿用这个风格。
- **不要为了让测试变绿而放宽断言、跳过测试或加 lint/type suppression。** 本轮没有放宽任何断言；§3.4 那 3 条红是改造步骤不完整，不是断言的问题。
- **守卫以棘轮形式落地**：先冻结当前清单，新增即失败。首次引入时不要写成「零泄漏」，否则守卫一开始就是红的。
- **一条新的取证习惯**：守卫/检查变绿后，做一次变异测试证明它会红。§5 那张表就是为此存在的。
- 文件超过 ESLint 上限时拆分文件，不要往 `packages/cli/eslint.config.js` 的豁免清单加名字。
- 新增行为要有测试；文档里不要写未经验证的行为。
- 运行时行为变更走「issue + `docs/superpowers/plans/` 计划」这条路。

---

## 10. 交接时的仓库实际状态

| 项                    | 状态                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test` 分支           | **干净**，本轮 commit 全部落在 `928a62920..test` 区间：惰性化 + 21 个调用点、守卫改真实路径匹配、两份计划文档勘误、守卫与 `load.ts` 的注释口径                                                                 |
| 相对 `origin/main`    | `test` 从 `e532b4971` 分叉；`origin/main` 现为 `3c2b598ef`，`dev/p0-hardening` 现为 `c94fced7f`。`test` 与两者**文件集无重叠**，`git merge-tree` 试合并均 exit 0，没有冲突。合并前仍需 rebase 到 `origin/main` |
| 共享检出              | `dev/p0-hardening` 干净，本任务全程未触碰                                                                                                                                                                      |
| worktree 里的构建产物 | `packages/cli/dist`、`core/dist`、`build-meta.json` 都已按当前 HEAD 重建，全部 gitignored                                                                                                                      |
