const fs = require("fs");

const directories = [
  // core
  "./core/node_modules",
  "./core/dist",
  // packages
  "./packages/config-types/node_modules",
  "./packages/config-types/dist",
  "./packages/fetch/node_modules",
  "./packages/fetch/dist",
  "./packages/llm-info/node_modules",
  "./packages/llm-info/dist",
  "./packages/config-yaml/node_modules",
  "./packages/config-yaml/dist",
  "./packages/openai-adapters/node_modules",
  "./packages/openai-adapters/dist",
  // docs
  "./docs/node_modules",
  // root
  "./node_modules",
];

directories.forEach((dir) => {
  if (fs.existsSync(dir)) {
    fs.rmdirSync(dir, { recursive: true });
    console.log(`Removed ${dir}`);
  } else {
    console.log(`${dir} not found`);
  }
});
