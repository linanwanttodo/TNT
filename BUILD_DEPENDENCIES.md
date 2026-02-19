# Build Dependencies & Secrets

What the CI and the release paths need to run, and what is optional. Everything
here is read from `.github/workflows/` and the packages' own scripts, so a row
that no longer matches a workflow is a bug in this file.

The CLI ships through GitHub Release assets, not a registry:
`Release the CLI for every desktop OS` assembles one tarball per platform because
the bundled `sqlite3` binding is native.

## Current state

`gh secret list --repo linanwanttodo/TNT` returns nothing today. Every path that
wants a credential is therefore inert rather than failing:

- `Release @tnt/*` runs a preflight and skips when the semantic-release tokens
  are absent, instead of turning every package commit red.
- `CLI PR Checks > smoke-api` skips on a push event and on a fork PR without
  secrets; the aggregate job lists it under `allowed-skips`.
- Core's provider tests are skipped when no key exists
  (`IGNORE_API_KEY_TESTS`, set by `.github/actions/check-llm-changes` from the
  changed files and from `TNT_HAS_PROVIDER_KEYS`).

## Gates

| Workflow                     | Trigger                                | Needs                                                              |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `engine-checks.yml`          | `pull_request` and `push` to `main`    | none - prettier, `core/`, and the npm packages (not the CLI)       |
| `cli-pr-checks.yml`          | `pull_request` and `push` to `main`    | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` for the `smoke-api` job only |
| `cla.yaml`                   | `issue_comment`, `pull_request_target` | contributor-assistant action configuration                         |
| `stale-issue-helper.yaml`    | daily schedule                         | none                                                               |
| `delete-stale-branches.yaml` | weekday schedule, manual               | `GITHUB_TOKEN` with `contents: write` - it deletes old branches    |
| `docs-gh-pages.yml`          | push to `main` touching docs, manual   | Pages enabled with "GitHub Actions" as the source                  |
| `docs-pr-checks.yml`         | `pull_request` touching docs           | none - type-checks and builds the docs site without publishing     |

Both gates ignore documentation-only commits (`paths-ignore`), and both fire on a
direct push to `main`: work lands that way here, and a gate that listens only to
`pull_request` never sees it.

Every job declares `timeout-minutes`. A hung install or a test process that never
exits would otherwise bill the six-hour default. The four `release-*.yml`
workflows call `reusable-release.yml` through `jobs.<id>.uses`, and a job that
only forwards takes no ceiling of its own, so they inherit the 5 and 40 minutes
declared inside the reusable workflow.

## Release paths

| Workflow                                                                                           | Trigger                   | Needs                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| `cli-release.yml`                                                                                  | manual                    | none beyond `GITHUB_TOKEN`; the version must match `packages/cli/package.json`               |
| `release-openai-adapters.yml` `release-config-yaml.yml` `release-fetch.yml` `release-llm-info.yml` | push touching the package | `SEMANTIC_RELEASE_GITHUB_TOKEN`, `SEMANTIC_RELEASE_NPM_TOKEN` through `reusable-release.yml` |

Those four publish `@tnt/*` npm packages. The CLI is not one of them.

## Secrets

| Secret                                                                                                                                                                                                                       | Purpose                                                  | Read by                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                                                                                                                                                                                                               | Default per-run token                                    | `cla.yaml`, `delete-stale-branches.yaml`, `docs-gh-pages.yml`, `cli-release.yml` |
| `SEMANTIC_RELEASE_GITHUB_TOKEN`                                                                                                                                                                                              | Creates the release/tag entries for package releases     | `reusable-release.yml` via the four `release-*.yml` wrappers                     |
| `SEMANTIC_RELEASE_NPM_TOKEN`                                                                                                                                                                                                 | Publishes the `@tnt/*` packages to npm                   | same                                                                             |
| `OPENAI_API_KEY`                                                                                                                                                                                                             | Provider tests in `core/` and the adapters               | `engine-checks.yml`, `reusable-release.yml`                                      |
| `ANTHROPIC_API_KEY`                                                                                                                                                                                                          | Anthropic tests, and the CLI `smoke-api` job             | `engine-checks.yml`, `cli-pr-checks.yml`, `reusable-release.yml`                 |
| `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `VOYAGE_API_KEY`, `RELACE_API_KEY`, `INCEPTION_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_GPT41_API_KEY`, `AZURE_FOUNDRY_CODESTRAL_API_KEY`, `AZURE_FOUNDRY_MISTRAL_SMALL_API_KEY` | Provider-specific tests that skip when the key is absent | `engine-checks.yml`, `reusable-release.yml`                                      |

## Local environment

`packages/cli` reads its configuration from the TNT global directory, `~/.tnt`
by default (`TNT_GLOBAL_DIR`, with `CONTINUE_GLOBAL_DIR` accepted as the older
name). The env example files are at:

- `packages/cli/.env.example`
- `packages/sdk/typescript/.env.example`

## Adding a runner dependency

`Search` and `Glob` register only when `rg` answers on `PATH`, so a machine
without ripgrep runs a different tool catalog than a machine with it - which is
why the CLI test job installs it rather than skipping those tools. Anything else
the tests shell out to belongs in the same place.
