import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const webuiRoot = path.dirname(fileURLToPath(import.meta.url));

// Every package in the monorepo hoists its own react copy; @dnd-kit's source
// must bind to exactly the instance the app renders with, or every hook call
// it makes lands on a second React whose dispatcher is null.
const reactAlias = {
  react: path.resolve(webuiRoot, "node_modules/react"),
  "react/jsx-runtime": path.resolve(
    webuiRoot,
    "node_modules/react/jsx-runtime",
  ),
  "react-dom": path.resolve(webuiRoot, "node_modules/react-dom"),
  "react-dom/client": path.resolve(webuiRoot, "node_modules/react-dom/client"),
};

export default defineConfig({
  base: "/app/",
  plugins: [
    react(),
    // P1 待办：`npm install` 装好 tailwindcss + @tailwindcss/vite 后取消下一行注释，
    // 并在 main.tsx 引入 src/ui/zcode/styles.css（@theme 主题 + 工具类），
    // 届时可删除 zcode-bridge.css。
    // tailwindcss(),
  ],
  resolve: {
    alias: reactAlias,
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      // The dev/build pipeline resolves react the same way, so the alias only
      // pins what was already the case; no bundle shape change.
      external: [],
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // If a future npm install un-symlinks the webui react copies, keep
        // dnd-kit riding the app's react through the alias above.
        inline: [/@dnd-kit\//],
      },
    },
  },
});
