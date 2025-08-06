#!/usr/bin/env node

import * as esbuild from "esbuild";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// Parse command line arguments
const args = process.argv.slice(2);
const noMinify = args.includes("--no-minify");

const __dirname = dirname(fileURLToPath(import.meta.url));

// List of packages to mark as external (ONLY native modules that cannot be bundled)
// Note: Everything else will be bundled to create a self-contained CLI
// Users should not need to install any additional dependencies
const external = [
  "fsevents", // macOS native file watcher (optional dependency)
  "./xhr-sync-worker.js", // JSDOM worker file that needs to be copied separately
];

console.log("Building CLI with esbuild...");

// Remove launcher shims left behind by earlier builds (for example the old
// "cn" command before the rename to "tnt"). They are untracked, so nothing
// else cleans them up, and a stale one would still ship inside the npm
// tarball and keep exposing a command that no longer exists.
const distDir = resolve(__dirname, "dist");
if (existsSync(distDir)) {
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (entry.isFile() && /^(cn|tnt)\.js$/.test(entry.name)) {
      rmSync(join(distDir, entry.name));
    }
  }
}

// Plugin to handle optional react-devtools-core
const optionalDevtoolsPlugin = {
  name: "optional-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => {
      // Return path to our stub instead of marking as external
      return { path: resolve(__dirname, "stubs/react-devtools-core.js") };
    });
  },
};

try {
  const result = await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: "dist/index.js",
    external,
    sourcemap: true,
    minify: !noMinify, // Use --no-minify flag to control minification
    metafile: true,
    plugins: [optionalDevtoolsPlugin],

    // Handle .js extensions in imports
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],

    // Handle TypeScript paths and local packages
    alias: {
      "@tnt/config-yaml": resolve(
        __dirname,
        "../../packages/config-yaml/dist/index.js",
      ),
      "@tnt/openai-adapters": resolve(
        __dirname,
        "../../packages/openai-adapters/dist/index.js",
      ),
      "@tnt/config-types": resolve(
        __dirname,
        "../../packages/config-types/dist/index.js",
      ),
      core: resolve(__dirname, "../../core"),
      "@tnt/fetch": resolve(
        __dirname,
        "../../packages/fetch/dist/index.js",
      ),
      "@tnt/llm-info": resolve(
        __dirname,
        "../../packages/llm-info/dist/index.js",
      ),
      "@tnt/terminal-security": resolve(
        __dirname,
        "../../packages/terminal-security/dist/index.js",
      ),
      // Aliased to the package root rather than a file: the SDK is imported
      // through deep paths such as "@tnt/sdk/dist/api/dist/index.js", and the
      // alias substitution keeps those subpaths intact.
      "@tnt/sdk": resolve(__dirname, "../../packages/sdk/typescript"),
    },

    // Add banner to create require for CommonJS packages
    banner: {
      js: `import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
    },
  });

  // Write metafile for analysis
  writeFileSync("dist/meta.json", JSON.stringify(result.metafile, null, 2));

  // Create wrapper script with shebang that explicitly runs the CLI
  // Note: We must call runCli(); a plain dynamic import will not execute the CLI.
  writeFileSync(
    "dist/tnt.js",
    "#!/usr/bin/env node\nimport { runCli } from './index.js';\nawait runCli();\n",
  );
  // Copy worker files needed by JSDOM
  const workerSource = resolve(
    __dirname,
    "node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js",
  );
  const workerDest = resolve(__dirname, "dist/xhr-sync-worker.js");
  try {
    copyFileSync(workerSource, workerDest);
    console.log("✓ Copied xhr-sync-worker.js");
  } catch (error) {
    console.warn("Warning: Could not copy xhr-sync-worker.js:", error.message);
  }

  // Make the wrapper script executable
  chmodSync("dist/tnt.js", 0o755);

  // Calculate bundle size
  const bundleSize = result.metafile.outputs["dist/index.js"].bytes;
  console.log(
    `✓ Build complete! Bundle size: ${(bundleSize / 1024 / 1024).toFixed(2)} MB`,
  );
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
