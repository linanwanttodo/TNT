# CLI 打包边界收敛与交付面硬化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 单一写者：本仓库同一时间只允许一个 agent 写代码；本计划在 `test` 分支执行，不要切到 `dev/p0-hardening`。

**Goal:** 让 CLI 的打包面只包含它真正调用的 core 代码，并把「文档 / 契约 / 类型」三类已经存在的隐性漂移变成会失败的守卫测试。

**Architecture:** 不做分层重写。收益集中在一个已经定位到具体行的静态导入链上：`packages/cli/src/retrieval/service.ts` → `core/config/ConfigHandler.ts` → `core/config/load.ts`，后者在文件顶部静态导入了 provider 注册表、遗留工具注册表和 context provider，因此 esbuild 把 core 的 IDE 时代代码整体打进了发行包。第一步先用守卫测试把这个边界冻结成「可以被违反就会被拒绝」的东西，再逐条改掉。其余任务是交付面（文档双语、契约冻结、lint 棘轮），每一项都能独立验收。

**Tech Stack:** TypeScript 5.8、esbuild 0.25（`packages/cli/build.mjs`）、vitest 3、ESLint 9 flat config、Ink 6。

---

## 一、执行环境（分支隔离）

另一个 agent 正在 `dev/p0-hardening` 上工作，因此本计划**不在主检出目录里改任何文件**。

| 项                     | 值                                                                             |
| ---------------------- | ------------------------------------------------------------------------------ |
| 主检出（另一个 agent） | `/home/lin/All_projects/GithubProjects/continue`，分支 `dev/p0-hardening`      |
| 本计划的隔离工作区     | `/home/lin/All_projects/GithubProjects/continue/.vitest/worktree`，分支 `test` |
| 基线提交               | `e532b4971`（与 `origin/main` 同一提交）                                       |

隔离工作区已用 `git worktree add` 建好，位置放在 `.vitest/` 下——该目录在 `.gitignore`、`.prettierignore`（`.vitest`）和 `packages/cli/eslint.config.js`（`**/.vitest/**`）里都已忽略，所以它不会污染主检出的 `git status`、格式化检查和 lint 检查，也不需要在仓库里新增任何忽略条目。

依赖已经就位：11 个 `node_modules` 用 `cp -al` 硬链接（约 2.8 GB，零额外占用，3 秒完成），9 个 `dist` 用 `cp -a` 真实拷贝（约 15 MB，避免构建时原地写坏主检出的产物）。

**所有命令都必须先 `cd` 进隔离工作区：**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree
```

工作区用完后的清理（不要在主检出里执行）：

```bash
cd /home/lin/All_projects/GithubProjects/continue
git worktree remove .vitest/worktree --force   # 会连同硬链接一起删掉，主检出的 node_modules 不受影响
git branch -d test                              # 如果还想保留 test 分支就不要执行这一行
```

**注意硬链接的语义：** `node_modules` 是硬链接到主检出的，所以本工作区里**不要**运行 `npm install`（npm 会就地改写文件，可能污染主检出）。产物目录 `dist` 是真实拷贝，可以放心重建。

## 二、现状证据（全部由命令实测）

这一节是本计划的依据。每条都可在工作区里用给出的命令复现。

### 2.1 发行包被 core 的 IDE 时代代码撑大

从 `packages/cli/dist/*.js.map` 直接解析 sourcemap：

```bash
cd packages/cli && node -e '
const fs=require("fs");const all=new Set();
for(const f of fs.readdirSync("dist").filter(f=>f.endsWith(".js.map"))){
  const m=JSON.parse(fs.readFileSync("dist/"+f,"utf8"));
  for(const s of (m.sources||[])) all.add(s);}
const core=[...all].filter(s=>s.includes("/core/")&&!s.includes("node_modules"));
console.log("core sources bundled:", core.length);'
```

实测结果：

| 指标                                    | 数值                                                 |
| --------------------------------------- | ---------------------------------------------------- |
| `packages/cli/dist` 总计                | **136 MB**（31 MB JS + 78 MB sourcemap）             |
| 单个 `service-*.js` chunk               | **16 MB**                                            |
| 打进包的 core 源文件                    | **306 个**（另有 3,531 个 `core/node_modules` 文件） |
| 其中 `core/context/*`                   | **44 个文件（全部）**                                |
| 其中 `core/tools/*`                     | **43 个文件**                                        |
| 其中 `core/llm/llms/*` provider 类      | **66 个**                                            |
| 其中 `core/vendor/@xenova/transformers` | 14 个文件                                            |
| CLI 源码中对 `core/context` 的引用      | **0 次**                                             |

也就是说：这 44 个 context provider、43 个遗留工具定义、66 个 provider 类**没有一个是 CLI 源码直接引用的**（见上表「CLI 源码中对 `core/context` 的引用 0 次」），但每一个都进了用户安装包里、并且被配置层的 eager 闭包拉着求值。

> **本节的 sourcemap 计数只适合描述「dist 里有什么」，不适合验证惰性化是否生效。** `splitting: true` 下被延迟的代码仍在 `dist/` 里，只是换了 chunk，所以这个数在改动前后恒为 306。验证请用 Task 7 Step 3 的 metafile eager 闭包。

### 2.2 传导链已定位到具体行

```
packages/cli/src/retrieval/service.ts:1
  import { ConfigHandler } from "core/config/ConfigHandler.js";
    → core/config/ConfigHandler.ts
      → core/config/load.ts           (870 行)
```

下表是**改动前 `core/config/load.ts` 的 9 行 + `core/llm/index.ts` 的 1 行**，共 10 处。当时据此写下「就是全部原因」，这句已被推翻：注册表经 5 个文件共 25 处进入配置层，下表只是最大的一处。完整清单与各自状态见交接文档 §3.1。

| 行  | 导入                                                                                   | 拖进来的东西                     |
| --- | -------------------------------------------------------------------------------------- | -------------------------------- |
| 38  | `{ MCPManagerSingleton } from "../context/mcp/MCPManagerSingleton"`                    | context/mcp 子树                 |
| 39  | `{ BaseLLM } from "../llm"`                                                            | core/llm 索引                    |
| 40  | `{ LLMClasses, llmFromDescription } from "../llm/llms"`                                | **66 个 provider 类**            |
| 41  | `CustomLLMClass from "../llm/llms/CustomLLM"`                                          | provider 子树                    |
| 42  | `{ LLMReranker } from "../llm/llms/llm"`                                               | provider 子树                    |
| 43  | `TransformersJsEmbeddingsProvider from "../llm/llms/TransformersJsEmbeddingsProvider"` | **vendored transformers 运行时** |
| 59  | `{ loadJsonMcpConfigs } from "../context/mcp/json/loadJsonMcpConfigs"`                 | context/mcp 子树                 |
| 60  | `CustomContextProviderClass from "../context/providers/CustomContextProvider"`         | context/providers 子树           |
| 61  | `{ getBaseToolDefinitions, serializeTool } from "../tools"`                            | **43 个遗留工具定义**            |
| —   | `core/llm/index.ts:69` `applyToolOverrides from "../tools/applyToolOverrides.js"`      | 遗留工具子树（同方向第二处）     |

**关键事实：这些导入全部只在函数体内被使用**（`load.ts:243` 起至 `632`），没有任何一个在模块顶层求值。函数 `intermediateToFinalConfig` 本身是 `async`。所以「改成惰性导入」在这份代码上是安全的，不需要改任何调用方签名。

### 2.3 `core/index.d.ts` 是手写的中枢类型模块

| 指标                           | 数值      |
| ------------------------------ | --------- |
| 行数                           | **2,142** |
| `export interface`             | 128       |
| `export type`                  | 51        |
| `export class`                 | 3         |
| `export enum`                  | 2         |
| `export ... from "..."` 再导出 | **0**     |
| 顶部 `import` 行               | 7         |

它不是从 core 各模块再导出的桶，而是**手写的集中类型声明**：`ChatHistoryItem`、`ChunkWithoutID`、`IContextProvider`、`IDE`、`ModelDescription` 这些名字在整个 core 里**只**在 `core/index.d.ts` 里声明，core 自己的模块反过来 `import type { ... } from "../index.js"` 取用它们。

这个模式本身可行（纯类型模块没有运行时需求），但有两个真实代价：

1. 它是一个 2,142 行的单点，**没有任何守卫测试**约束它的规模。改动它不会触发任何失败。
2. 里面声明了 3 个 `class`（`SignatureHelp` / `SignatureInformation` / `ParameterInformation`）——class 是有运行时值的。已经存在一处**值语法**导入类型名的情况：

   ```
   core/config/profile/LocalProfileLoader.ts:3
   import { TntConfig, IDE, ILLMLogger } from "../../index.js";
   ```

   这行今天能跑，只是因为 esbuild 会剔除 TS 里未被当作值使用、且指向不存在文件的导入。它靠的是打包器的宽容，不是语言的保证。

### 2.4 文档双语缺口

英文页 23 份、中文页 20 份，缺 3 个孪生页：

- `docs/troubleshooting.mdx`
- `docs/reference.mdx`
- `docs/snippets/cli-install.mdx`

`CONTRIBUTING.md` 的要求是「一个用户可见的 flag、配置键、工具或 hook 的变更，需要在同一个 PR 里同时更新英文页、中文页，以及 `docs/docs.json` 和 `docs/docs.zh.json` 的导航条目」。目前没有任何测试会因此失败。

### 2.5 lint 与类型门禁的现状

- `packages/cli` 的 `npx tsc --noEmit`：**通过**（exit 0）
- `packages/cli` 的 `npx eslint src test-utils`：**915 个文件，1 个问题**（`unused-imports/no-unused-imports`）
- `@typescript-eslint/no-floating-promises` 目前是 **`warn`**（`packages/cli/eslint.config.js:53`，注释写明是为了让存量调用可以被分批处理）
- `@typescript-eslint/no-explicit-any` 在 CLI 被 **`"off"`**（`packages/cli/eslint.config.js:127`，注释是「可能对 CLI 太严格」）
- 生产代码（排除 node_modules / dist / vendor / 测试）里：`: any` 544 处、`as any` 251 处、`@ts-ignore` 23 处、`eslint-disable` 14 处
- `CONTRIBUTING.md` 宣称「当一个文件越过上限，就拆分它——不要加 override」，而 `packages/cli/eslint.config.js:156-174` 存在一份 12 个文件的豁免清单

### 2.6 处置：进入本计划 vs 另开计划

按 superpowers 的 scope check，下面这条**属于独立子系统，不在本计划内**，需要单独一份计划：

> **LLM provider 双栈收敛。** `core/llm/llms/*`（约 70 个文件）与 `packages/openai-adapters/src/apis/*`（32 个 API）各实现一遍，其中 11 个 provider 是双份：OpenAI 795/306 行、Bedrock 750/771、Gemini 545/551、VertexAI 543/563、Anthropic 502/561、WatsonX 460/353、Cohere 331/212、OpenRouter 191/73、Moonshot 68/87、MiniMax 37/35、Relace 25/178。这不是历史遗留：`ClawRouter` 正在两边同时被实现。缓存语义（本项目最在意的指标，8 个缓存专项测试都在 adapters 侧）因此有两个事实来源。
>
> 不放进本计划的原因：它需要先做一次产品决策（谁是对外契约、core 的类是否退化为薄包装），而且必须配套一次真实 key 的缓存 A/B 测量才能安全落地。先做本计划的任务 1-7，能在不引入 API 语义变更的前提下拿到大部分体积收益，并让那次决策更容易做。

---

## Global Constraints

以下约束来自仓库自己的规则，每一项都适用于本计划的每一个任务。

- 每个 commit 之前必须四项全绿：`npx vitest run`、`npx tsc --noEmit`、`npx eslint .`、`npx prettier --check "src/**/*.{ts,tsx}" "test-utils/**/*.{ts,tsx}"`（prettier 用**仓库根**的二进制，见 `ARCHITECTURE-tnt.md` 末尾一节）。
- Conventional commits；一个 commit 只做一件可评审的事。
- 代码、注释、文档、文件名、commit message 里**不出现其他产品的名字**，一律用中性措辞。
- 每一句新的用户可见文案都要同时有 `en` 和 `zh` 条目（`packages/cli/src/i18n/index.ts`）。
- 用户可见的 flag / 配置键 / 工具 / hook 变更，要同时更新英文页、中文页和两个导航文件。
- 新增内置工具要同步更新：`ALL_BUILT_IN_TOOLS`、`builtInToolNames.ts`、权限策略、按工具的延迟集合、`tools/documentedSurface.test.ts`、前缀指纹。
- 不要为了让测试变绿而放宽断言、跳过测试或给 lint 加 suppression。守卫测试以「棘轮」形式落地（冻结一份清单，新增即失败），不要写成会随实现漂移的宽松断言。
- 文件超过 ESLint 上限时拆分，不要往 `eslint.config.js` 的豁免清单里加名字。

---

## File Structure

| 文件                                                | 责任                                                 | 动作 |
| --------------------------------------------------- | ---------------------------------------------------- | ---- |
| `core/staticImportBoundary.vitest.ts`               | 冻结「哪些 core 文件不允许在运行时导入注册表」的边界 | 新建 |
| `core/indexContract.vitest.ts`                      | 冻结 `core/index.d.ts` 的规模与结构计数              | 新建 |
| `core/config/load.ts`                               | 配置装配；把注册表导入改为惰性                       | 修改 |
| `core/llm/index.ts`                                 | core 的 LLM 索引；把 `../tools` 导入改为惰性         | 修改 |
| `packages/cli/src/docsLocaleCoverage.test.ts`       | 断言每份英文文档都有中文孪生页                       | 新建 |
| `docs/zh/troubleshooting.mdx`                       | 中文故障排查页                                       | 新建 |
| `docs/zh/reference.mdx`                             | 中文参考页                                           | 新建 |
| `docs/zh/snippets/cli-install.mdx`                  | 中文安装片段                                         | 新建 |
| `packages/cli/eslint.config.js`                     | 把 `no-floating-promises` 提为 error                 | 修改 |
| `packages/cli/src/floatingPromises.ratchet.test.ts` | 冻结现存 floating promise 违规清单                   | 新建 |

---

## Workstream 1：交付面与契约守卫

四个任务互相独立，可以任意顺序执行；建议按 1 → 2 → 3 → 4。

---

### Task 1: 清理隔离工作区之外仍然存在的构建残留

**Files:**

- Delete（仅限主检出目录，**不经过 git**，因为这些文件本来就没有被跟踪）：
  - `/home/lin/All_projects/GithubProjects/continue/packages/cli/tnt-cli-v1.0.{0,1,2,3,4,5,6}.tar.gz`
  - `/home/lin/All_projects/GithubProjects/continue/core/e2e.log`
  - `/home/lin/All_projects/GithubProjects/continue/e2e.log`
  - `/home/lin/All_projects/GithubProjects/continue/packages/cli/e2e.log`
  - `/home/lin/All_projects/GithubProjects/continue/packages/tnt-elsewhere/`
  - `/home/lin/All_projects/GithubProjects/continue/eval/`

**Interfaces:**

- Consumes: 无
- Produces: 无（纯交付面整理，不产出代码）

**为什么这是一个任务：** 这些是 350 MB 的历史 release tar、734 MB 的 `.mimosa` 之外的杂项、以及两个空壳目录（`packages/tnt-elsewhere/` 只有一个 4 字节 `notes.md`，`eval/` 只有一个 `.gitignore`）。它们全部**没有被 git 跟踪**，所以删除不影响任何分支，也不需要 commit。

- [ ] **Step 1: 确认这些路径确实没有被跟踪**

```bash
cd /home/lin/All_projects/GithubProjects/continue
git ls-files packages/cli/*.tar.gz core/e2e.log e2e.log eval packages/tnt-elsewhere
```

Expected: 输出为空。**如果有任何输出，停下**——说明这个文件是被跟踪的，删除会变成一次需要评审的变更，本任务不处理。

- [ ] **Step 2: 记录删除前的占用**

```bash
du -ch packages/cli/*.tar.gz | tail -1
du -sh core/e2e.log .mimosa .vitest 2>/dev/null
```

Expected: tar 包合计约 350 MB。

- [ ] **Step 3: 删除**

```bash
rm -f packages/cli/tnt-cli-v1.0.*.tar.gz core/e2e.log e2e.log packages/cli/e2e.log
rmdir eval packages/tnt-elsewhere 2>/dev/null || rm -rf eval packages/tnt-elsewhere
```

- [ ] **Step 4: 验证主检出的分支与跟踪状态没有变化**

```bash
cd /home/lin/All_projects/GithubProjects/continue
git branch --show-current
git status --short | wc -l
```

Expected: `dev/p0-hardening`，且未跟踪条目数量比删除前**减少**，已跟踪文件数不变（`git ls-files | wc -l` 与删除前一致）。

- [ ] **Step 5: 不需要 commit**

这一步没有代码变更。如果 Step 4 显示任何被跟踪文件消失，回滚并报告。

---

### Task 2: 给 `core/index.d.ts` 加规模与结构棘轮

**Files:**

- Create: `core/indexContract.vitest.ts`
- Modify: `core/index.d.ts`（仅在需要把某个 `export class` 改成 `export interface` 时；本任务默认不改）

**Interfaces:**

- Consumes: 无
- Produces: 一个读取 `core/index.d.ts` 的计数函数，以及冻结的 `EXPECTED_CONTRACT_SHAPE` 常量

**背景：** `core/index.d.ts` 有 2,142 行、184 个导出声明，是 CLI 与 core 之间唯一的手写类型契约，且没有任何测试约束它。参照 `packages/cli/src/tools/toolPrefixFingerprint.test.ts` 的做法——把形状冻成数字，任何变化都必须是一次显式编辑。

- [ ] **Step 1: 写失败的测试**

Create `core/indexContract.vitest.ts`:

```ts
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `core/index.d.ts` is the only hand-written type contract between core and its
 * consumers, and nothing measured it before. It re-declares rather than
 * re-exports: names such as `ChatHistoryItem` and `IDE` are declared here and
 * nowhere else, and core's own modules import them back out of `../index.js`.
 *
 * A ratchet, not an achievement list. Growing the contract is a deliberate edit:
 * change the numbers below in the same commit and say why.
 */
const EXPECTED_CONTRACT_SHAPE = {
  lines: 0,
  interface: 0,
  type: 0,
  class: 0,
  enum: 0,
  importLines: 0,
};

const CONTRACT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "index.d.ts",
);

function shapeOf(text: string) {
  const count = (prefix: string) =>
    text.split("\n").filter((line) => line.startsWith(prefix)).length;

  return {
    lines: text.split("\n").length,
    interface: count("export interface "),
    type: count("export type "),
    class: count("export class "),
    enum: count("export enum "),
    importLines: count("import "),
  };
}

describe("core/index.d.ts, the hand-written type contract", () => {
  const text = readFileSync(CONTRACT, "utf8");

  it("reads a contract large enough for the answer to mean something", () => {
    // Floor: an empty or unreadable file would otherwise satisfy every
    // assertion below by accident.
    expect(text.length).toBeGreaterThan(10_000);
    expect(shapeOf(text).interface).toBeGreaterThan(50);
  });

  it("keeps the contract's shape to the frozen numbers", () => {
    expect(shapeOf(text)).toEqual(EXPECTED_CONTRACT_SHAPE);
  });

  it("declares no class, because a class is a runtime value and this file has no runtime", () => {
    // A class declared in a types-only module can only ever be imported wrongly:
    // `import { X } from "core/index.js"` as a value resolves to a file that does
    // not exist. Types and enums cost nothing at runtime; classes do.
    expect(shapeOf(text).class).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认它以两种方式失败**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/core
npx vitest run indexContract.vitest.ts
```

Expected: FAIL。

- 「keeps the contract's shape」失败，因为 `EXPECTED_CONTRACT_SHAPE` 全是 0；
- 「declares no class」也应失败，因为文件里有 3 个 `export class`。

如果「declares no class」通过了，说明 `export class` 的计数写法与实际文件不符，先修正计数再继续。

- [ ] **Step 3: 打印真实形状并填入常量**

```bash
node -e '
const t=require("fs").readFileSync("core/index.d.ts","utf8");
const c=p=>t.split("\n").filter(l=>l.startsWith(p)).length;
console.log(JSON.stringify({
  lines: t.split("\n").length,
  interface: c("export interface "),
  type: c("export type "),
  class: c("export class "),
  enum: c("export enum "),
  importLines: c("import "),
}, null, 2));'
```

把输出填进 `EXPECTED_CONTRACT_SHAPE`。当前已实测的参考值（用与测试相同的 `split("\n").length` 口径）是：`lines: 2143`、`interface: 128`、`type: 51`、`class: 3`、`enum: 2`、`importLines: 7`。注意 `lines` 比 `wc -l` 的 2142 多 1。

- [ ] **Step 4: 把 3 个 class 改成 interface**

`core/index.d.ts` 里的 `SignatureHelp`（第 1674 行）、`SignatureInformation`（1696）、`ParameterInformation`（1720）没有运行时实现。先确认它们在 core 里没有对应的 class 实现：

```bash
grep -rn "class SignatureHelp\|class SignatureInformation\|class ParameterInformation" core --include='*.ts' | grep -v node_modules | grep -v '^core/index.d.ts'
```

Expected: 输出为空。若为空，把这 3 个 `export class` 改成 `export interface`（保留字段，去掉任何方法体语法）。

- [ ] **Step 5: 运行测试，确认全绿**

```bash
npx vitest run indexContract.vitest.ts
```

Expected: PASS（3 个测试）。把 `EXPECTED_CONTRACT_SHAPE.class` 更新为 `0`。

- [ ] **Step 6: 跑该包的全量门禁并提交**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/core
npx vitest run && npx tsc -p ./ --noEmit
cd .. && git add core/indexContract.vitest.ts core/index.d.ts
git commit -m "test(core): ratchet the hand-written type contract's shape"
```

---

### Task 3: 用守卫测试替代「靠自觉」的中英双语同步

**Files:**

- Create: `packages/cli/src/docsLocaleCoverage.test.ts`
- Create: `docs/zh/troubleshooting.mdx`
- Create: `docs/zh/reference.mdx`
- Create: `docs/zh/snippets/cli-install.mdx`

**Interfaces:**

- Consumes: 无
- Produces: 无导出；这是一个纯守卫测试

**背景：** 现有守卫（`moduleDocsAccuracy.test.ts`、`docsAccuracy.test.ts`、`tuiDoc.test.ts`）已经会检查「文档里写的路径和 `npm run` 命令是否存在」。缺的是「英文页有没有中文孪生页」这一条。

- [ ] **Step 1: 写失败的测试**

Create `packages/cli/src/docsLocaleCoverage.test.ts`:

```ts
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * CONTRIBUTING requires the English page, the Chinese page and both navigation
 * files to change together. Nothing failed when a page landed without its twin,
 * so three had drifted by the time this landed. The exemption list is the
 * deliberate part: a fragment with nothing user-visible in it does not need a
 * translation, and saying so here is cheaper than guessing later.
 */
const NO_TRANSLATION_NEEDED = [
  // Install one-liners that a package manager owns verbatim; the surrounding
  // pages carry the prose in both languages.
  "snippets/cli-install.mdx",
];

const DOCS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs",
);

function mdxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "zh") continue;
      found.push(...mdxFiles(full));
    } else if (name.endsWith(".mdx")) {
      found.push(path.relative(DOCS, full));
    }
  }
  return found;
}

describe("the Chinese twin of every documentation page", () => {
  const pages = mdxFiles(DOCS);

  it("finds a real documentation tree", () => {
    // Floor: a path that stopped resolving would otherwise report zero missing
    // pages, which is the same green as a perfect translation.
    expect(pages.length).toBeGreaterThan(15);
    expect(existsSync(path.join(DOCS, "zh"))).toBe(true);
  });

  it("has one, or is named as needing none", () => {
    const missing = pages
      .filter((page) => !NO_TRANSLATION_NEEDED.includes(page))
      .filter((page) => !existsSync(path.join(DOCS, "zh", page)));

    expect(missing).toEqual([]);
  });

  it("has no Chinese page whose English original is gone", () => {
    const orphans = mdxFiles(path.join(DOCS, "zh")).filter(
      (page) => !existsSync(path.join(DOCS, page)),
    );

    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认它报出缺的两页**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/packages/cli
npx vitest run src/docsLocaleCoverage.test.ts
```

Expected: FAIL，`missing` 为 `["reference.mdx", "troubleshooting.mdx"]`。如果它报出 `snippets/cli-install.mdx`，说明 `NO_TRANSLATION_NEEDED` 的写法没匹配上，先修正。

- [ ] **Step 3: 补上两页中文**

对照 `docs/troubleshooting.mdx` 和 `docs/reference.mdx` 逐节翻译成 `docs/zh/troubleshooting.mdx`、`docs/zh/reference.mdx`。要求：

- frontmatter 保留 `title` / `description`，用中文；
- 所有代码块、命令、路径原样保留，只翻译散文；
- 两页都必须出现在 `docs/docs.zh.json` 的导航里（`reference.mdx` 与 `troubleshooting.mdx` 的对应条目）。

- [ ] **Step 4: 运行测试，确认全绿**

```bash
npx vitest run src/docsLocaleCoverage.test.ts
```

Expected: PASS（3 个测试）。

- [ ] **Step 5: 跑该包全量门禁并提交**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/packages/cli
npx vitest run && npx tsc --noEmit
cd ../.. && git add docs/zh docs/docs.zh.json packages/cli/src/docsLocaleCoverage.test.ts
git commit -m "docs(zh): translate the reference and troubleshooting pages, and guard the pair"
```

---

### Task 4: 把 floating promise 从警告变成被冻结的错误

**Files:**

- Modify: `packages/cli/eslint.config.js:53`
- Create: `packages/cli/src/floatingPromises.ratchet.test.ts`

**Interfaces:**

- Consumes: 无
- Produces: 无导出；守卫测试读取 ESLint 的 JSON 输出

**背景：** `@typescript-eslint/no-floating-promises` 现在是 `warn`，理由写在注释里（让存量调用分批处理）。一个 warning 不会让 CI 变红，所以「分批处理」没有终点。做法与 `KNOWN_MUTUAL_COUPLING` 一致：先把存量凭据冻成清单，再禁止新增。

- [ ] **Step 1: 先量出现存违规**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/packages/cli
npx eslint src test-utils --format json > /tmp/floating-before.json
node -e '
const r=require("/tmp/floating-before.json");
const hits=[];
for(const f of r) for(const m of f.messages)
  if(m.ruleId==="@typescript-eslint/no-floating-promises")
    hits.push(f.filePath.replace(process.cwd()+"/","")+":"+m.line);
console.log(hits.length+" hits");
console.log(hits.join("\n"));'
```

把这个清单原样保存下来——Step 3 要用它。

- [ ] **Step 2: 写守卫测试，冻结这份清单**

Create `packages/cli/src/floatingPromises.ratchet.test.ts`，把 Step 1 的输出填进 `FROZEN`：

```ts
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The rule is an error, so a new floating promise fails lint on its own. This
 * test exists for the opposite direction: the frozen list may only shrink. A
 * call that was triaged away must be deleted from it in the same commit, so the
 * debt is visible in review instead of living in a warning nobody reads.
 */
const FROZEN: string[] = [
  // Filled from the measured baseline in the step that created this file.
];

const CLI_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function floatingPromises(): string[] {
  const raw = execFileSync(
    "npx",
    ["eslint", "src", "test-utils", "--format", "json"],
    { cwd: CLI_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const hits: string[] = [];
  for (const file of JSON.parse(raw)) {
    for (const message of file.messages) {
      if (message.ruleId === "@typescript-eslint/no-floating-promises") {
        hits.push(`${path.relative(CLI_ROOT, file.filePath)}:${message.line}`);
      }
    }
  }
  return hits;
}

describe("floating promises", () => {
  it("matches the frozen list exactly, so it can only shrink", () => {
    const measured = floatingPromises();

    expect(measured).toEqual(FROZEN);
  }, 300_000);
});
```

- [ ] **Step 3: 把规则提升为 error**

在 `packages/cli/eslint.config.js` 里把：

```js
      // A floating promise is how an async failure disappears: the CLI keeps
      // running and the user sees nothing. It starts as a warning so the
      // existing calls can be triaged instead of landing as one red build.
      "@typescript-eslint/no-floating-promises": "warn",
```

改成：

```js
      // A floating promise is how an async failure disappears: the CLI keeps
      // running and the user sees nothing. The calls that predate this rule are
      // frozen in src/floatingPromises.ratchet.test.ts, so the list may only
      // shrink and a new one fails here.
      "@typescript-eslint/no-floating-promises": "error",
```

- [ ] **Step 4: 运行守卫测试，确认它通过**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/packages/cli
npx vitest run src/floatingPromises.ratchet.test.ts
```

Expected: PASS。如果它失败并列出差异，说明 Step 1 的清单与 Step 3 之后的输出不一致（行号会因 `eslint.config.js` 的改动而**不变**，但如果你在 Step 1 和 Step 3 之间改过任何源文件就会漂移）——重新测量并更新 `FROZEN`。

- [ ] **Step 5: 跑全量门禁并提交**

```bash
npx eslint src test-utils    # 必须只剩已知的 unused-import 之外的 0 个 error
npx tsc --noEmit
npx vitest run
cd .. && git add packages/cli/eslint.config.js packages/cli/src/floatingPromises.ratchet.test.ts
git commit -m "chore(lint): make a floating promise an error and freeze the backlog"
```

---

## Workstream 2：core 打包边界（核心任务）

顺序固定：Task 5 先写下会失败的守卫，Task 6 改实现让它变绿，Task 7 测量收益并收紧冻结清单。

---

### Task 5: 写下会失败的 core 静态导入边界守卫

**Files:**

- Create: `core/staticImportBoundary.vitest.ts`

**Interfaces:**

- Consumes: 无
- Produces: 无导出；守卫测试读取 `core/config/load.ts` 与 `core/llm/index.ts` 的源码文本

**背景：** esbuild 只看静态的运行时导入。守住这几个文件的导入形态，就守住了 306 个 core 文件的打包面。这与 `packages/cli/src/architecture.test.ts` 的做法一致：读源码文本，按棘轮冻结。

> **本节是最初的设计稿，落地版本与它有三处不同，以 `core/staticImportBoundary.vitest.ts` 现文件为准**：
> ① 匹配按 `path.resolve` 的**真实路径**，不是 specifier 字符串前缀（字符串比较深度敏感，`../../tools` 会静默漏报）；
> ② `../tools` 按**精确 barrel** 匹配，不匹配 `../tools/applyToolOverrides.js`——它是只引类型与一个包的叶子，按前缀匹配会把它误报成泄漏；
> ③ 读取的是 **6 个** consumer 而非 2 个，注册表内部互引不计。
> 见交接文档 §5 与其变异测试表。

- [ ] **Step 1: 写失败的测试**

Create `core/staticImportBoundary.vitest.ts`:

```ts
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The CLI reaches core through `core/config/ConfigHandler.ts`. Whatever that
 * file imports at runtime is what ships in a user's installation. Measured on
 * 2026-10-27, ten runtime imports across two files put 306 core source files in
 * the bundle - every context provider the CLI never calls, every legacy tool
 * definition, 66 provider classes and the vendored transformers runtime.
 *
 * `import type` is free: TypeScript erases it and esbuild never sees it. So the
 * rule is not "do not refer to these registries" but "do not load them".
 *
 * Matching is by prefix, not by equality: `"../tools"` has to catch
 * `"../tools/applyToolOverrides.js"`, which is how the second file below leaks
 * the tool tree in. An equality match silently reports zero offenders there.
 */
const REGISTRY_MODULES = [
  "../llm",
  "../tools",
  "../context/mcp",
  "../context/providers",
];

const isRegistry = (specifier: string) =>
  REGISTRY_MODULES.some(
    (registry) =>
      specifier === registry || specifier.startsWith(`${registry}/`),
  );

/** Loaded at runtime today. Every entry is a defect, not an allowance. */
const ALLOWED_RUNTIME_IMPORTS: string[] = [];

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every top-level `import ... from "<registry>"` in `text` that is not a
 * type-only import. Only top-level statement lines are considered, which is what
 * makes the check survive a dynamic `await import(...)` inside a function body:
 * that form carries no leading `import` keyword, and `import type` is skipped.
 */
function runtimeRegistryImports(text: string): string[] {
  const hits: string[] = [];
  let inTypeBlock = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("import type ")) continue;

    // A multi-line `import {\n  type A,\n  type B,\n} from "..."` marks the
    // whole statement as type-only on its opening line.
    if (trimmed.startsWith("import {")) {
      inTypeBlock = trimmed.includes("type {");
    }

    const specifier = trimmed.match(/from\s+"([^"]+)"/)?.[1];
    if (!specifier) continue;
    if (!isRegistry(specifier)) continue;
    if (inTypeBlock) continue;

    hits.push(`${specifier} <- ${trimmed}`);
  }

  return hits.sort();
}

describe("the registry imports core loads on behalf of the CLI", () => {
  const consumers = ["config/load.ts", "llm/index.ts"];

  it("reads files that still contain the imports this guard is about", () => {
    // Floor, and the reason this is not a text scan that can silently pass:
    // if the files were renamed the guard must fail, not report zero offenders.
    const text = readFileSync(path.join(ROOT, "config/load.ts"), "utf8");
    expect(text.length).toBeGreaterThan(5_000);
    expect(text).toContain("intermediateToFinalConfig");
  });

  it("loads no provider, tool or context registry at runtime", () => {
    const measured = consumers.flatMap((relative) =>
      runtimeRegistryImports(readFileSync(path.join(ROOT, relative), "utf8")),
    );

    expect(measured).toEqual(ALLOWED_RUNTIME_IMPORTS);
  });
});
```

- [ ] **Step 2: 运行测试，确认它以列出缺陷的方式失败**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/core
npx vitest run staticImportBoundary.vitest.ts
```

Expected: FAIL，第二个测试打印出 **10 条** registry 运行时导入：`config/load.ts` 里 9 条（`../llm`、`../llm/llms`、`../llm/llms/CustomLLM`、`../llm/llms/TransformersJsEmbeddingsProvider`、`../llm/llms/llm`、`../tools`、`../context/mcp/MCPManagerSingleton`、`../context/mcp/json/loadJsonMcpConfigs`、`../context/providers/CustomContextProvider`），加上 `llm/index.ts` 里 1 条（`../tools/applyToolOverrides.js`）。

这 10 条已经在本计划定稿前用同一份匹配逻辑实测过。如果你看到 0 条，最可能的原因是匹配退化成了等值比较——`"../tools"` 就抓不到 `"../tools/applyToolOverrides.js"`。先修正再继续。

---

### Task 6: 让 `core/config/load.ts` 惰性加载注册表

**Files:**

- Modify: `core/config/load.ts:38-43`、`core/config/load.ts:59-61`
- Modify: `core/llm/index.ts:69`
- Test: `core/staticImportBoundary.vitest.ts`（Task 5 已建）

**Interfaces:**

- Consumes: Task 5 的守卫测试
- Produces: 无新的导出签名。`load.ts` 的既有导出（`resolveSerializedConfig`、`isContextProviderWithParams` 等）签名不变

**关键约束：这 8 个导入全部只在函数体内使用**，且使用它们的函数（`intermediateToFinalConfig` 等）是 `async`，所以 `await import(...)` 是安全的，调用方签名不需要改。

- [ ] **Step 1: 逐个确认导入的用途，决定 type 还是 lazy**

对每个名字，先确认它是否只出现在类型位置：

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree
for n in BaseLLM LLMClasses llmFromDescription CustomLLMClass LLMReranker TransformersJsEmbeddingsProvider MCPManagerSingleton loadJsonMcpConfigs CustomContextProviderClass getBaseToolDefinitions serializeTool; do
  echo "--- $n ---"
  grep -nE "\b$n\b" core/config/load.ts | grep -vE "^\s*[0-9]+:import " | head -6
done
```

按这份输出判断：只作为类型出现的（预期是 `BaseLLM`）改 `import type`；作为值被 `new` 或调用的改 `await import(...)`。

- [ ] **Step 2: 把第 38-43 行与 59-61 行改成类型导入 + 惰性导入**

保留所有纯类型导入为顶层 `import type`（零运行时成本），例如：

```ts
import type { BaseLLM } from "../llm";
```

把运行时导入删掉，并在真正使用它们的位置写惰性导入。`TransformersJsEmbeddingsProvider` 有两个使用点（第 393、411 行），`LLMClasses` 有两个（第 395、441 行），所以每个模块在**单个函数作用域内**只 `await import` 一次，把结果放进局部常量：

```ts
async function intermediateToFinalConfig(
  {
    // ...unchanged parameters...
  }: {
    // ...unchanged types...
  },
) {
  const [
    { LLMClasses, llmFromDescription },
    { default: CustomLLMClass },
    { LLMReranker },
  ] = await Promise.all([
    import("../llm/llms"),
    import("../llm/llms/CustomLLM"),
    import("../llm/llms/llm"),
  ]);

  // ...unchanged body, now using the local bindings...
}
```

`getBaseToolDefinitions` 与 `serializeTool` 分别在第 462、632 行使用；`MCPManagerSingleton` 在第 507 行、`loadJsonMcpConfigs` 在第 523 行、`CustomContextProviderClass` 在第 377 行。它们各自所在函数内做同样的处理。

`core/llm/index.ts:69` 的 `../tools/applyToolOverrides.js` 同样处理：找到它的使用点，改成惰性导入。

- [ ] **Step 3: 运行守卫测试，确认它变绿**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/core
npx vitest run staticImportBoundary.vitest.ts
```

Expected: PASS。

- [ ] **Step 4: 运行 core 的完整门禁**

```bash
npx vitest run && npx tsc -p ./ --noEmit && npx eslint . --ext ts
```

Expected: 全绿。**不要**用 `IGNORE_API_KEY_TESTS` 之外的方式跳过测试；如果 `llm.vitest.ts` 因缺少凭据而 401，按 `ARCHITECTURE-tnt.md` 的说明设 `IGNORE_API_KEY_TESTS=true`，并在 commit message 里注明。

- [ ] **Step 5: 重建 core，再验证 CLI 仍然可用**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/core
npm run build
cd ../packages/cli
npx tsc --noEmit && npx vitest run
```

Expected: 全绿。这一步是必要的：惰性导入只有真的被解析到才算通过，类型检查不会执行到它。

- [ ] **Step 6: 提交**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree
git add core/config/load.ts core/llm/index.ts core/staticImportBoundary.vitest.ts
git commit -m "perf(core): load provider, tool and context registries lazily"
```

---

### Task 7: 测量打包收益，并把冻结清单收紧

**Files:**

- Modify: `core/staticImportBoundary.vitest.ts`（仅在守卫的注释里记录实测数字）
- Modify: `packages/cli/ARCHITECTURE-tnt.md`（记录这一次的体积变化）

**Interfaces:**

- Consumes: Task 5 的守卫、Task 6 的实现
- Produces: 一份可以写进 commit message 与 ARCHITECTURE 文档的实测数字

**为什么必须有这一步：** 这个仓库的规矩是「每个数字都由命令产生，不由手写」。没有测量的性能声明在这里不算完成。

- [ ] **Step 1: 先测「改动前」的基线**

在 `test` 分支上 stash 掉 Task 6 的实现，或用 `git stash`/`git checkout e532b4971 -- core/config/load.ts core/llm/index.ts` 临时回到基线，然后构建：

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/packages/cli
npm run build
du -sh dist
find dist -name '*.js' -exec du -cb {} + | tail -1
```

记下三个数字：`dist` 总量、JS 总量、最大的 chunk 名称与大小（`ls -S dist/*.js | head -1`）。

- [ ] **Step 2: 恢复 Task 6 的实现，重新构建并测同样三个数字**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree
git checkout test -- core/config/load.ts core/llm/index.ts   # 或 git stash pop
cd packages/cli && npm run build
du -sh dist
find dist -name '*.js' -exec du -cb {} + | tail -1
ls -S dist/*.js | head -1
```

- [ ] **Step 3: 用 metafile 的 chunk 归属验证惰性化真的生效**

**不要用 sourcemap 的 source 计数做这一步。** `packages/cli/build.mjs` 开了 `splitting: true`，被延迟的代码仍然在 `dist/` 里，只是进了独立 chunk——所以 2.1 节那个「306」在惰性化前后都是 306，永远不降。它衡量「dist 里有什么」，不衡量「哪条路径要加载什么」。据此会得出「改了等于没改」的错误结论。

```bash
node -e '
const fs=require("fs");const m=JSON.parse(fs.readFileSync("build-meta.json","utf8"));
const out=m.outputs;
// 入口是 dist/index.js（dist/tnt.js 只是 await import("./index.js") 的壳）
function closure(entry){const seen=new Set(),q=[entry];
  while(q.length){const k=q.pop();if(seen.has(k))continue;seen.add(k);
    for(const i of (out[k].imports||[])) if(i.kind==="import-statement"&&out[i.path]) q.push(i.path);}
  return seen;}
function tally(keys){let b=0,n=0,ctx=0,tools=0,llms=0;
  for(const k of keys) for(const [p,i] of Object.entries(out[k].inputs)){b+=i.bytesInOutput;n++;
    if(p.includes("/core/context/"))ctx+=i.bytesInOutput;
    if(p.includes("/core/tools/"))tools+=i.bytesInOutput;
    if(p.includes("/core/llm/llms/"))llms+=i.bytesInOutput;}
  return {b,n,ctx,tools,llms};}
const svc=Object.keys(out).filter(k=>/^dist\/service-.*\.js$/.test(k))
  .sort((a,b)=>tally([b]).b-tally([a]).b)[0];
for(const [label,keys] of [["进程启动",closure("dist/index.js")],["配置路径",closure(svc)]]){
  const r=tally([...keys]);
  console.log(label+" eager 闭包: "+r.n+" inputs / "+r.b.toLocaleString()+" B  ctx="+r.ctx+" tools="+r.tools+" llms="+r.llms);}'
```

Expected: **进程启动那一行在改动前后完全不变**（844,600 B / 442 inputs，且 `ctx`/`tools`/`llms` 恒为 0——配置层根本不在入口的 eager 闭包里）。要看的是「配置路径」那一行的 `inputs` 与 `ctx` 下降。

若 `ctx` 仍然存在，说明还有第二条静态导入路径，回到 Step 1 用 `grep -rn "context/" core/config core/llm --include='*.ts'` 找出来。

> **「最大的 chunk 就是启动 chunk」是错的**，别用它当指标：`service-*.js` 只被 `dynamic-import` 边引用，是 retrieval service 的 chunk（`packages/cli/src/retrieval/service.ts` 是全仓唯一 import `ConfigHandler` 的文件）。详见交接文档 §3.5。

- [ ] **Step 4: 把实测数字写进守卫的注释与架构文档**

把 Step 1/2/3 的数字（改动前后的「进程启动 eager 闭包」与「配置路径 eager 闭包」的 inputs 和字节、`dist` 的 JS 总量）写进 `core/staticImportBoundary.vitest.ts` 文件头的注释，替换掉 `2026-10-27` 那句实测说明里的旧数字；同时在 `packages/cli/ARCHITECTURE-tnt.md` 的「The cached prefix」之外新起一节记录这次变化，风格对齐既有条目（先写机制，再写被哪个测试固定）。

不要写「最大 chunk」：它的身份会随 chunk 边界重划而漂移（本轮改动后最大 chunk 就变成了 `chunk-OIMSHNAI.js`，与启动无关）。

- [ ] **Step 5: 跑两端门禁并提交**

```bash
cd /home/lin/All_projects/GithubProjects/continue/.vitest/worktree/core && npx vitest run
cd ../packages/cli && npx vitest run && npx tsc --noEmit && npx eslint src test-utils
cd .. && git add core/staticImportBoundary.vitest.ts packages/cli/ARCHITECTURE-tnt.md
git commit -m "docs(core): record the measured bundle reduction from lazy registries"
```

---

## Self-Review

**Spec coverage:** 本计划覆盖第二节里识别出的三类可独立落地的问题——交付面残留（Task 1）、手写契约无守卫（Task 2）、文档双语无守卫（Task 3）、lint 棘轮（Task 4）、打包面（Task 5-7，本次收益最大的一项）。第二类问题里的 LLM 双栈收敛已在 2.6 节显式排除，并说明了排除理由（需要产品决策 + 真实 key 测量）；这是有意不覆盖，不是遗漏。

**Placeholder scan:** 每个步骤都带可执行的命令或可粘贴的代码。Task 2 的 `EXPECTED_CONTRACT_SHAPE` 与 Task 4 的 `FROZEN` 需要执行者填入实测值，这是棘轮模式的固有形态（先测量再冻结），步骤里给了确切的测量命令和当前的参考值，不是「待定」。

**Type consistency:** `runtimeRegistryImports` / `REALITY_MODULES`(→`REGISTRY_MODULES`) / `ALLOWED_RUNTIME_IMPORTS` 在 Task 5 与 Task 6 之间名称一致；`shapeOf` 与 `EXPECTED_CONTRACT_SHAPE` 的字段名一致；Task 5 的 `consumers` 数组与 Task 6 修改的两个文件一致。

**已知的验证边界:** 本计划无法在没有真实 provider key 的环境下验证缓存行为；Task 6 的惰性导入只由单元测试、类型检查、重建 core 后 CLI 的全量测试和构建产物的 sourcemap 四条证据共同支撑，没有端到端调用真实模型的验证。这一点在 Task 7 的测量里被显式记录下来，不要把它表述成「已验证运行时行为」。
