---
name: tnt-review
description: Run the TNT CLI's local AI review agents over working-tree changes. Use when asked to "run checks", "review my changes with AI", "lint with AI", "apply AI-suggested fixes", or to author review agents in `.tnt/agents/*.md`.
license: Apache-2.0
metadata:
  author: TNT
  version: "2.0.0"
---

# tnt review — local AI review of a diff

Review agents are markdown instructions that each get the diff, read and edit files in an
isolated git worktree, and come back with either nothing (pass) or a patch (fail with a
suggestion). Everything runs on your machine against your own model config: there is no
login, no hub, and no service to be configured with.

## When to use

- Someone asks for an AI review of the current branch or their uncommitted work
- A project wants reusable review agents committed under `.tnt/agents/`
- AI-suggested fixes need to be applied to the working tree, or handed over as a patch

## Prerequisites

- Node.js 18+ and a git repository with something to diff
- A model selected in `~/.tnt/config.yaml` — `tnt review` uses the session's chat model
  unless `--review-model` names another

```bash
npm install -g @tnt/cli
tnt review --uncommitted
```

That is the whole setup. `tnt check`, `cn check` and `cn login` are not commands in this CLI;
the capability they described is this one.

## Running reviews

With no flags, review discovers every `*.md` in `.tnt/agents/` (first) and `.tnt/checks/`
(second, so a name that exists in both resolves to the agent) and runs them against the
branch diff.

```bash
tnt review                         # all discovered agents, against the auto-detected base
tnt review --uncommitted           # only staged + unstaged changes
tnt review --base develop          # diff against a specific ref
tnt review --commit HEAD~2         # one commit, as it stood
tnt review --range main...HEAD     # an arbitrary git range
```

Run a chosen set instead of what's discovered — each value must be a **file path**, because
there is no platform left to resolve a name against:

```bash
tnt review --review-agents .tnt/agents/security.md
tnt review --review-agents .tnt/agents/security.md .tnt/agents/docs.md
```

Other switches:

```bash
tnt review --format json           # machine-readable report (see below)
tnt review --patch                 # the suggested patches, for `git apply`
tnt review --fix                   # apply them to the working tree
tnt review --fail-fast             # stop at the first agent that reports a problem
tnt review --review-model gpt-4o   # a different model for the agents than the session's
tnt review --config ./config.yaml  # a config other than ~/.tnt/config.yaml
tnt review --verbose               # worker stderr, when a worker dies
```

## Writing a review agent

A plain markdown prompt at `.tnt/agents/<name>.md`. Say what to look for and what to do about it:

```markdown
# Security Review

You are a security reviewer. Examine the code changes for:

- SQL injection and command injection
- XSS in user-facing output
- Hardcoded secrets or credentials
- Insecure use of eval() or similar

If you find issues, edit the files to fix them. If everything looks good, say so and exit.
```

The agent is handed the full diff, the changed-file list, and a worktree it may read and
write. Any edit it makes becomes a patch, and that agent reports **fail** with the fix
attached — so an agent that stays silent about a clean diff is behaving correctly.

## How it runs

1. **Diff** — resolves the range from the flags above
2. **Resolve** — the `--review-agents` paths, else the local directories
3. **Worktree** — one detached git worktree per agent, so nothing touches your tree
4. **Run** — a forked worker per agent, in parallel, each with full tool access
5. **Capture** — `git diff` inside the worktree becomes the patch
6. **Report** — pass (no patch), fail (patch), or error

An agent that runs past five minutes is cut off; narrow the diff or split the prompt if you
hit it.

## Output

On a terminal you get a live table, then a report with each agent's prose and patch:

```
tnt review  -  3 agents against main  -  5 changed files

Agent               Status       Time
--------------------------------------------
Security Review     * Running     12s
Code Style          Pass           8s
Documentation       Pending        -
```

With `--format json` the report is:

```json
{
  "reviews": [
    {
      "agent": ".tnt/agents/security.md",
      "name": "Security Review",
      "status": "pass",
      "patch": "",
      "output": "No security issues found.",
      "duration": 8.2
    }
  ],
  "summary": { "total": 1, "passed": 1, "failed": 0, "errored": 0 }
}
```

An agent that finds something adds a non-empty `patch`; one that dies has `status: "error"`
and an `error` field. When an agent emits findings in the structured form, a `findings` array
is added alongside `output` — the prose is left intact either way.

## Troubleshooting

| What you see                           | What it means                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `No changes detected`                  | Nothing to diff — pass `--base`, `--uncommitted`, `--commit` or `--range`                          |
| no agents run                          | `.tnt/agents/` and `.tnt/checks/` are empty; the command exits with nothing to review              |
| `hub review sources are not available` | A `--review-agents` value was a name, not a path. Point it at the `.md` file.                      |
| a worker exits with code 1             | Re-run with `--verbose` to read the worker's stderr                                                |
| `--fix` skips a patch                  | It conflicted with the tree; take it manually: `tnt review --patch > r.patch && git apply r.patch` |
