# packages/sdk

Two different things share this directory, and only one of them is installed by
anything.

## `typescript/` — `@tnt/sdk`

The package the CLI bundles. It is reached as a file dependency
(`packages/cli/package.json` → `file:../../packages/sdk/typescript`), which is
why the CLI's install step builds it before bundling itself. It holds the shape
of a resolved assistant (`AssistantConfig`, which is `AssistantUnrolled` from
`@tnt/config-yaml`) and, under `dist/api`, the generated client for a TNT
platform API — the one `tnt serve --id` and the config loader use against
whatever base URL the operator configures. See `typescript/README.md`.

## this directory — `@tnt/sdk-generator`

A development harness, not a runtime dependency. Its only build and test steps
are echoes, and nothing imports it. What it is for:

```bash
cd packages/sdk
npm ci
npm run generate-client   # openapi.yaml -> typescript/api
npm run swagger-ui        # browse openapi.yaml locally
```

Regenerating replaces the whole `typescript/api` tree, so a regenerated client
is reviewed as generated code: the diff is what the upstream schema says, not
what this repository wanted.

## What used to be here

A Python client under `python/` and a `Continue.from()` factory in the
TypeScript package. Neither was reachable from any command: no code
constructed the factory, and no script or document outside the generator
itself referenced the Python tree. A CLI-only product does not carry
unconsumed SDKs for languages it does not ship, so both are gone.
