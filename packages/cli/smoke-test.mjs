#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The build splits: `dist/index.js` is the entry chunk and the code it pulls in
 * lands in hashed siblings, so a single file is not the bundle. Anything that
 * measures or greps the output has to go across the chunks, or it reads a
 * kilobyte-scale entry file and reports an 854-byte "bundle".
 */
function bundleChunks() {
  const dir = resolve(__dirname, "dist");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => resolve(dir, name));
}

// Colors for output
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log(`${colors.green}✓${colors.reset}`);
    testsPassed++;
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset}`);
    console.error(`  Error: ${error.message}`);
    testsFailed++;
  }
}

function execCommand(command, options = {}) {
  return execSync(command, {
    cwd: __dirname,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
}

console.log("🧪 Running smoke tests for bundled CLI...\n");

// Test 1: Check if bundle exists
runTest("Bundle file exists", () => {
  if (!existsSync(resolve(__dirname, "dist/index.js"))) {
    throw new Error("dist/index.js not found");
  }
  if (!existsSync(resolve(__dirname, "dist/tnt.js"))) {
    throw new Error("dist/tnt.js not found");
  }
});

// Test 2: Check if wrapper script is executable
runTest("Wrapper script has shebang", () => {
  const content = readFileSync(resolve(__dirname, "dist/tnt.js"), "utf8");
  if (!content.startsWith("#!/usr/bin/env node")) {
    throw new Error("Wrapper script missing shebang");
  }
});

// Cross-platform command execution helper
function getCLICommand(args = "") {
  const isWindows = process.platform === "win32";
  if (isWindows) {
    return `node dist/tnt.js ${args}`;
  } else {
    return `./dist/tnt.js ${args}`;
  }
}

// Test 3: Version command works
runTest("Version command", () => {
  const output = execCommand(getCLICommand("--version"));
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, "package.json"), "utf8"),
  );
  if (!output.includes(packageJson.version)) {
    throw new Error(
      `Version mismatch. Expected ${packageJson.version}, got: ${output}`,
    );
  }
});

// Test 4: Help command works
runTest("Help command", () => {
  const output = execCommand(getCLICommand("--help"));
  // Asserted against strings the help actually prints. A literal that drifted
  // out of the usage text fails here as a false alarm, which is what this test
  // was doing before.
  if (!output.includes("Usage: tnt") || !output.includes("--version")) {
    throw new Error("Help output missing expected content");
  }
});

// Test 5: Check bundle size
runTest("Bundle size is reasonable", () => {
  const chunks = bundleChunks();
  if (chunks.length === 0) {
    throw new Error("No JavaScript output in dist/");
  }
  const bytes = chunks.reduce((total, file) => total + statSync(file).size, 0);
  const sizeInMB = bytes / (1024 * 1024);

  console.log(`(${sizeInMB.toFixed(1)}M across ${chunks.length} chunks)`);

  // A floor, because an output that is nearly empty would pass any ceiling: the
  // entry chunk alone is under a kilobyte. A full build measures near 30 MB.
  if (sizeInMB < 10) {
    throw new Error(`Bundle unexpectedly small: ${sizeInMB.toFixed(1)}M`);
  }
  if (sizeInMB > 40) {
    throw new Error(`Bundle too large: ${sizeInMB.toFixed(1)}M`);
  }
});

// Test 6: Check that local packages are bundled
runTest("Local packages are bundled", () => {
  const bundleContent = bundleChunks()
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  // Check for code from @tnt/config-yaml
  if (
    !bundleContent.includes("AssistantUnrolled") &&
    !bundleContent.includes("config-yaml")
  ) {
    throw new Error("@tnt/config-yaml not properly bundled");
  }

  // Check for code from @tnt/openai-adapters
  // Since the bundle is minified, check for strings that would be present
  // even after minification (e.g., error messages, property names)
  if (
    !bundleContent.includes("anthropic") &&
    !bundleContent.includes("gemini") &&
    !bundleContent.includes("openai") &&
    !bundleContent.includes("azure") &&
    !bundleContent.includes("bedrock")
  ) {
    throw new Error("@tnt/openai-adapters not properly bundled");
  }
});

// Test 7: Test that the CLI can be invoked programmatically
runTest("CLI can be invoked", () => {
  try {
    // Test that the CLI runs without crashing when given no args
    const isWindows = process.platform === "win32";
    const nullDevice = isWindows ? "nul" : "/dev/null";
    execCommand(`${getCLICommand("--help")} > ${nullDevice} 2>&1`);
  } catch (error) {
    throw new Error(`CLI invocation failed: ${error.message}`);
  }
});

// Test 8: Check metadata file
// The metafile sits beside the package rather than inside dist, so that the
// dist directory the package and the release tarball copy is only runtime code.
runTest("Build metadata exists", () => {
  if (!existsSync(resolve(__dirname, "build-meta.json"))) {
    throw new Error("build-meta.json not found");
  }

  const meta = JSON.parse(
    readFileSync(resolve(__dirname, "build-meta.json"), "utf8"),
  );
  if (!meta.inputs || !meta.outputs) {
    throw new Error("Invalid metadata structure");
  }
});

// Test 9: Verify no missing external dependencies
runTest("No missing runtime dependencies", () => {
  // This would fail in Test 3 if dependencies were missing, but let's be explicit
  const output = execCommand(`${getCLICommand("--version")} 2>&1`, {
    env: { ...process.env, NODE_ENV: "production" },
  });

  if (
    output.includes("Cannot find module") ||
    output.includes("MODULE_NOT_FOUND")
  ) {
    throw new Error("Missing module detected in output");
  }
});

// Test 10: Test npm link scenario
runTest("CLI works via npm link", () => {
  try {
    // Simply test that we can execute with node directly
    const output = execCommand("node dist/tnt.js --version 2>&1");
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, "package.json"), "utf8"),
    );
    if (!output.includes(packageJson.version)) {
      throw new Error("Version not found when running via node");
    }
  } catch (error) {
    throw new Error(`npm link scenario failed: ${error.message}`);
  }
});

// Summary
console.log("\n" + "=".repeat(50));
if (testsFailed === 0) {
  console.log(
    `${colors.green}✅ All ${testsPassed} tests passed!${colors.reset}`,
  );
  process.exit(0);
} else {
  console.log(
    `${colors.red}❌ ${testsFailed} test(s) failed, ${testsPassed} passed${colors.reset}`,
  );
  process.exit(1);
}
