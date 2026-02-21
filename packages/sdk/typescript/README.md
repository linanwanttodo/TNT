# @tnt/sdk

> **⚠️ EXPERIMENTAL: This package is in early development and subject to frequent breaking changes without notice.**

Two things live here, and neither of them contacts a service on its own:

- `Assistant` — the shape of a resolved assistant (`AssistantConfig` is `AssistantUnrolled`
  from `@tnt/config-yaml`) with the small helpers the CLI uses to pick a model
- `dist/api` — the generated client for a TNT platform API, consumed by `tnt serve --id`
  through whatever base URL the operator sets

There used to be a third: a `Continue.from()` factory that built an OpenAI-compatible client
pointed at a hosted hub and required an `apiKey`. Nothing in this repository ever constructed
it, and the hub it spoke to is not part of this product, so it is gone.

## Installation

```bash
npm install @tnt/sdk
```

## Assistant

```typescript
import { Assistant } from "@tnt/sdk";

const assistant = new Assistant(configFromYaml);

// The model to use for a role, falling back to the assistant's own default.
const model = assistant.getModel("claude-3-7-sonnet-latest");
```

`Assistant` takes the unrolled config object, not a slug: resolve a `config.yaml` with
`@tnt/config-yaml` and hand the result over.

## Platform API client

The `DefaultApi` client is generated from `../openapi.yaml` and is exported from
`@tnt/sdk/dist/api`. The CLI uses its `DefaultApiInterface` type; to talk to it you supply a
base URL, because there is no default one:

```typescript
import { Configuration, DefaultApi } from "@tnt/sdk/dist/api/dist/index.js";

const api = new DefaultApi(new Configuration({ basePath: process.env.TNT_API_BASE }));
```

## Regenerating the client

The generator lives in the parent package (`@tnt/sdk-generator`):

```bash
cd packages/sdk
npm run generate-client:typescript   # openapi.yaml -> typescript/api
npm run generate-client:ALL          # and the python client
```

`cd packages/sdk/typescript && npm run build` runs `tsc` over `src/` and the generated
`api/` tree into `dist/`.
