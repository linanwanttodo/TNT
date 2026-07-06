/**
 * Typing gaps exposed by importing `@zcode/services/node`.
 *
 * Its host graph is TypeScript source that the vendored package typechecks with
 * its own tsconfig. The CLI's program reaches a few node-only modules through
 * that graph whose declarations rely on libs or @types packages the CLI does
 * not ship:
 *
 * - `ReadableStream` async iteration is `lib.dom.asynciterable`.
 * - `yazl` and `node-forge` resolve to untyped JavaScript at their call sites.
 *
 * The reference directive and the two ambient declarations keep the CLI's
 * pre-existing typecheck green without editing the vendored package. The
 * factories are still bundled from their real sources.
 *
 * Both module shims type the package as `any` for the whole program. That is
 * deliberate and acceptable today: the CLI never calls `yazl` or `node-forge`
 * directly, they only appear inside the vendored plugin bundle graph, and a
 * hand-written declaration would have to track upstream releases. If the CLI
 * ever calls them, replace these with real types.
 */

/// <reference lib="dom.asynciterable" />

declare module "yazl";
declare module "node-forge";
