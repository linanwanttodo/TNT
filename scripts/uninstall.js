const fs = require("fs");

const directories = [
  // core
  "./core/node_modules",
  "./core/dist",
  // packages (mirrors scripts/build-packages.js plus the CLI delivery surface)
  "./packages/cli/node_modules",
  "./packages/cli/dist",
  "./packages/config-types/node_modules",
  "./packages/config-types/dist",
  "./packages/terminal-security/node_modules",
  "./packages/terminal-security/dist",
  "./packages/fetch/node_modules",
  "./packages/fetch/dist",
  "./packages/llm-info/node_modules",
  "./packages/llm-info/dist",
  "./packages/config-yaml/node_modules",
  "./packages/config-yaml/dist",
  "./packages/openai-adapters/node_modules",
  "./packages/openai-adapters/dist",
  "./packages/sdk/typescript/node_modules",
  "./packages/sdk/typescript/dist",
  // docs
  "./docs/node_modules",
  // root
  "./node_modules",
];

directories.forEach((dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Removed ${dir}`);
  } else {
    console.log(`${dir} not found`);
  }
});
