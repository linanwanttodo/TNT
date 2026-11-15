# TNT PR Review Actions

GitHub Actions that provide automated code reviews for pull requests using the TNT
CLI.

## Available Actions

This repository provides a GitHub Action for automated PR reviews:

### General Review Action

Provides high-level PR assessment with overall feedback and recommendations.

- **Path:** `linanwanttodo/TNT/actions/general-review@main`
- **Trigger:** `@tnt-review`
- **Output:** Summary comment with strengths, issues, and recommendations

## Quick Start

### Setting up General Review

```yaml
name: PR General Review
on:
  pull_request:
    types: [opened, ready_for_review]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: linanwanttodo/TNT/actions/general-review@main
        with:
          agent-file: ".tnt/agents/review.md"
```

## Inputs

The action accepts the following inputs:

| Input         | Description                                                      | Required |
| ------------- | ---------------------------------------------------------------- | -------- |
| `agent-file`  | Repository-relative agent markdown file to review with           | Yes      |
| `config-file` | Assistant configuration to use, defaulting to the CLI's own pick | No       |

## Setup Requirements

### 1. An agent file in the repository

The CLI loads an agent from a local markdown file with YAML frontmatter, e.g.
`.tnt/agents/review.md`:

```markdown
---
name: review
description: Reviews a pull request against the diff the action wrote
model: claude-sonnet-4-5
---

Review the changes described in `pr_diff.txt` and report strengths, issues by
severity, and an overall recommendation.
```

`model:` names a model **defined in the assistant configuration** - it is matched
against the models that configuration loads, not downloaded.

### 2. Model credentials

The review runs on the assistant configuration found in the checkout, so the
provider key comes from that file's `apiKey` reference - usually a secret mapped
into the job environment, as in the Quick Start above.

There is no platform key to register. The hosted service this action used to
require has been removed from the product, and the CLI reads no such variable.

### 3. Workflow Permissions

The workflow requires these permissions:

- `contents: read` - To checkout and read repository code
- `pull-requests: write` - To post review comments on PRs
- `issues: write` - To respond to comment triggers

## Triggering Reviews

The action can be triggered in two ways:

### Automatic Triggers

- When a PR is opened by a team member (OWNER, MEMBER, or COLLABORATOR)
- When a PR is marked as "ready for review" by a team member

### Manual Triggers

Team members can trigger reviews by commenting on any pull request:

- `@tnt-review` - Triggers a review

## Review Output

The general review provides a structured comment that includes:

- **Strengths**: What was done well in the PR
- **Issues Found**: Categorized by severity (Critical, High, Medium, Low)
- **Suggestions**: Improvement recommendations
- **Overall Assessment**: Final recommendation (APPROVE, REQUEST_CHANGES, or COMMENT)

## How It Works

1. Checks out repository code
2. Fetches the PR diff with the GitHub CLI
3. Builds a review prompt from the diff
4. Runs the CLI headless with the agent file, reading the prompt from stdin
5. Posts the review as a PR comment

The run is given no shell tool: the reviewer needs the diff the action already
wrote, not a shell in a checkout of a branch that may not be trusted.

## Versioning

We recommend using the main branch:

- `@main` - Uses the latest code from the main branch

Example:

```yaml
uses: linanwanttodo/TNT/actions/general-review@main
```

## Troubleshooting

### Review not triggering

- Ensure the PR author or commenter has appropriate permissions (OWNER, MEMBER, or COLLABORATOR)
- Check that the workflow file is in the default branch
- Check that the trigger comment contains `@tnt-review`

### No review output generated

- Read the action logs: the CLI's stderr is printed there
- Verify `agent-file` points at a markdown file committed on the revision under review
- Verify the provider credential that the assistant configuration names is set as a job secret

## Support

For issues or questions:

- [TNT Documentation](https://github.com/linanwanttodo/TNT/tree/main/docs)
- [GitHub Issues](https://github.com/linanwanttodo/TNT/issues)
- [GitHub Discussions](https://github.com/linanwanttodo/TNT/discussions)
