import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pdfJsCMapsPlugin } from "../ui/vite/pdfJsCMapsPlugin.js";
import { resolveRemoteFrontendVersion } from "./vite/remoteFrontendVersion.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const { version } = JSON.parse(
  readFileSync(resolve(HERE, "../../package.json"), "utf-8"),
) as { version: string };

function resolveZCodeEnv(value: string | undefined): "test" | "production" {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

export default defineConfig(({ mode }) => ({
  plugins: [pdfJsCMapsPlugin(), react(), tailwindcss()],
  resolve: {
    // The vendored packages are installed per package (file: links) instead of
    // the upstream workspace hoist, so `ui` and `web` each get a React copy.
    // Two copies break hooks: the shell renders with one, the component reads
    // useContext from the other. Dedupe to this app's copy.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": resolve(HERE, "../ui/src"),
      // d3-shape 3.x needs d3-path's Path export; pin prebundling to the 3.x
      // entry that ui installed through the hoist shim rather than letting an
      // ancestor node_modules expose an older 1.x copy.
      "d3-path": resolve(HERE, "../../node_modules/d3-path/src/index.js"),
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  worker: {
    rollupOptions: {
      treeshake: false,
    },
  },
  define: {
    __ZCODE_VERSION__: JSON.stringify(
      resolveRemoteFrontendVersion(version, process.env.WEB_REMOTE_FRONTEND_VERSION),
    ),
    __ZCODE_ENV__: JSON.stringify(resolveZCodeEnv(process.env.ZCODE_ENV)),
    __ZCODE_COMMIT__: JSON.stringify(process.env.ZCODE_COMMIT || "unknown"),
  },
  build: {
    sourcemap: mode === "production" ? "hidden" : true,
  },
}));
