# Build Process Documentation

## Overview

The TNT CLI uses esbuild to bundle the application along with local packages (`@tnt/config-yaml` and `@tnt/openai-adapters`) into a single distributable file. This ensures that users who install the CLI from npm don't need to worry about local file references.

## Build Steps

1. **Build packages**: `cd ../../ && node ./scripts/build-packages.js`
2. **Install dependencies**: `npm install`
3. **Build**: `npm run build`
   - This first builds the local packages
   - Then bundles everything with esbuild

## How it Works

### Bundling Strategy

The `build.mjs` script uses esbuild to:

- Bundle all TypeScript/JavaScript code into a single ES module
- Include local packages (`@tnt/config-yaml`, `@tnt/openai-adapters`) directly in the bundle
- Keep problematic or native dependencies external (e.g., `winston`, `express`)
- Create a wrapper script (`dist/tnt.js`) with the proper shebang for CLI execution

### Key Features

- **Local Package Bundling**: Local packages are bundled directly, avoiding `file:` reference issues
- **Stub for Optional Dependencies**: `react-devtools-core` is stubbed to prevent runtime errors
- **CommonJS Compatibility**: Adds `createRequire` to support packages that use dynamic requires
- **Source Maps**: Generates source maps for debugging
- **Metadata**: Creates `build-meta.json` beside the package with bundle analysis information (kept out of `dist` so it is never published)

## Testing

### Smoke Tests

Run smoke tests to verify the build:

```bash
npm run test:smoke
```

The smoke tests verify:

- Bundle files exist
- CLI commands work (--version, --help)
- Bundle size is inside the gate `smoke-test.mjs` actually applies: over 10 MB and
  under 40 MB across the split chunks. A full build measures 29.6 MB over 256
  files, and the test prints that number on every run.
- Local packages are properly bundled
- No missing runtime dependencies

## Troubleshooting

### Common Issues

1. **Module not found errors**: Check if the module needs to be added to the external list in `build.mjs`
2. **Native module issues**: Native modules should be marked as external
3. **Bundle too large**: Review bundled packages in `build-meta.json` and consider marking large packages as external

### Analyzing the Bundle

After building, check `build-meta.json` to see:

- What packages were bundled
- Bundle size breakdown
- Input/output file mappings

## Publishing

When publishing to npm:

1. The bundled files in `dist/` are included
2. Users install via `npm install -g @tnt/cli`
3. The `tnt` command becomes available globally (`package.json` `bin` points at `dist/tnt.js`)
4. No local file references or missing dependencies

## Environment

The state directory is `TNT_GLOBAL_DIR`, falling back to the older `TNT_GLOBAL_DIR` and then to
`~/.tnt`. It holds `settings.json`, `sessions/`, `permissions.yaml` and the `cache-breaks/` report
directory, so setting it moves all four together. Both names are read in
`src/config/globalDir.ts`; the older one is kept because it is already present in existing shells and
CI configuration, where ignoring it would look like a lost configuration rather than a rename.

Logging level is `TNT_LOG_LEVEL`, falling back to `TNT_LOG_LEVEL`; a value the logger does not
recognize is ignored rather than raised. Telemetry stays off unless asked for: `TNT_METRICS_ENABLED=1`
(or `TNT_ENABLE_TELEMETRY=1` with an OTEL endpoint) turns it on, and `=0` turns it off.

The complete set of variable names the CLI reads is not maintained by hand - `src/branding.test.ts`
scans the sources and fails if a `TNT_` or `CONTINUE_` name is read without being listed there.
