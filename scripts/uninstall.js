const fs = require("fs");

const directories = [
  // gui
  "./ide/gui/node_modules",
  "./ide/gui/out",
  "./ide/gui/dist",
  // core
  "./core/node_modules",
  "./core/dist",
  // ide/vscode
  "./ide/vscode/node_modules",
  "./ide/vscode/bin",
  "./ide/vscode/build",
  "./ide/vscode/out",
  // binary
  "./binary/node_modules",
  "./binary/bin",
  "./binary/dist",
  "./binary/out",
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
  "./packages/hub/node_modules",
  "./packages/hub/dist",
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
