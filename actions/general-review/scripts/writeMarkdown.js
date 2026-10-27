const fs = require("fs");
const path = require("path");

const messages = {
  missing_agent_file: `## Code Review Summary

⚠️ AI review skipped: the agent file is not in the checkout.

### Configuration Required
- Pass \`agent-file\` as a repository-relative path to an agent markdown file
- Confirm that file is committed on the revision the workflow checked out
`,
  cli_install_failed: `## Code Review Summary

⚠️ AI review skipped: TNT CLI installation failed.

### Troubleshooting
- Check that npm installation succeeded
- Verify @tnt/cli package is available
`,
  empty_output: `## Code Review Summary

⚠️ TNT CLI returned an empty response. Please check the configuration.
`,
  cli_not_found: `## Code Review Summary

⚠️ TNT CLI is not properly installed. Please ensure @tnt/cli is installed globally.
`,
  config_error: `## Code Review Summary

⚠️ TNT configuration error. Check the assistant configuration and the agent file the action was given.
`,
  auth_error: `## Code Review Summary

⚠️ The model provider refused the request. Check the credential the assistant configuration reads from the job environment.
`,
  generic_failure: `## Code Review Summary

⚠️ AI review failed.

### Troubleshooting
- Read the CLI error output in the workflow logs
- Verify the agent file and assistant configuration in the checkout
- Confirm the provider credential named by that configuration is set as a job secret
`,
};

function main() {
  const [outputPath, messageKey] = process.argv.slice(2);

  if (!outputPath || !messageKey) {
    console.error("Usage: node writeMarkdown.js <outputPath> <messageKey>");
    process.exit(1);
  }

  const message = messages[messageKey];

  if (!message) {
    console.error(`Unknown message key: ${messageKey}`);
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(absolutePath, message, "utf8");
  console.log(`Wrote ${messageKey} message to ${absolutePath}`);
}

main();
