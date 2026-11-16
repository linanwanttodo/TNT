<h1 align="center">TNT</h1>

<p align="center">Pioneering open-source coding agent</p>

<div align="center">

<a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" /></a>
<a href="https://github.com/linanwanttodo/TNT/tree/main/docs"><img src="https://img.shields.io/badge/Docs-TNT-blue" /></a>
<a href="https://github.com/linanwanttodo/TNT/releases"><img src="https://img.shields.io/badge/Changelog-GitHub_Releases-blue" /></a>

</div>

<p align="center">
  <img src="media/github-readme.png" alt="Banner" />
</p>

## What is TNT?

> _TNT is a community fork of Continue, rebuilt around the CLI._

TNT is a coding agent that runs as a CLI: one engine driving the interactive terminal, headless runs, a local HTTP server, and ACP editors. It also ships a WebUI for browsers and phones, and a desktop-style workflow surface built from the same session engine.

## Install

TNT is distributed as prebuilt tarballs on [GitHub Releases](https://github.com/linanwanttodo/TNT/releases); it is **not** published on npm. The install scripts download the matching platform archive and place the `tnt` binary on your PATH.

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/linanwanttodo/TNT/main/packages/cli/scripts/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/linanwanttodo/TNT/main/packages/cli/scripts/install.ps1 | iex
```

Add a model to `~/.tnt/config.yaml`, then run `tnt` inside a repository. The
[quickstart](https://github.com/linanwanttodo/TNT/blob/main/docs/cli/quickstart.mdx)
takes it from there.

## Documentation

To learn how to configure TNT, how it works, and how to customize it, check out the [TNT Docs](https://linanwanttodo.github.io/TNT/).

## Editor and desktop clients

VS Code, JetBrains and Electron hosts embed the same engine, protocol and web UI.
See [docs/CLIENTS.md](docs/CLIENTS.md) for the `tnt serve` daemon handshake,
authentication, embedding recipes and the host/native boundary.

## Release

[![GitHub Releases](https://img.shields.io/badge/Releases-181717?logo=github&logoColor=white)](https://github.com/linanwanttodo/TNT/releases) [![View source](https://img.shields.io/badge/View_source-181717?logo=github&logoColor=white)](packages/cli)

TNT builds on the final Continue 2.0.0 release and develops the CLI surface only. The editor extensions from that release have been removed. Releases are built by the `cli-release.yml` workflow for linux-x64, darwin-x64, darwin-arm64 and win32-x64.

## Open source and acknowledgements

TNT stands on several open-source projects. The codebases below are used as source, vendored, ported, or used as a design reference; each retains its own license and copyright. See [packages/zcode-ui/NOTICE.md](packages/zcode-ui/NOTICE.md), [packages/zcode-ui/THIRD-PARTY-NOTICES.md](packages/zcode-ui/THIRD-PARTY-NOTICES.md) and [packages/zcode-ui/UPSTREAM-DIVERGENCES.md](packages/zcode-ui/UPSTREAM-DIVERGENCES.md) for the vendored tree's own notices and the list of local adaptations.

| Project             | What TNT uses                                                                                                                                                                                                                                                                                  | Link                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continue            | The base fork: core agent engine, LLM adapters, config formats, indexing and tool abstractions. TNT is a derivative work of the final 2.0.0 release.                                                                                                                                           | https://github.com/continuedev/continue                                                                                                                                      |
| ZCode               | The WebUI / browser and phone interface: the `packages/zcode-ui/*` tree is vendored ZCode source (UI, web shell, services, shared schemas, RPC, client and provider packages), adapted to run against TNT's local engine.                                                                      | https://github.com/zai-org/ZCode                                                                                                                                             |
| Gemini CLI          | Terminal input components ported verbatim or trimmed: the text buffer, keypress provider, key bindings, vim buffer actions, TextInput rendering, terminal capability manager, terminal modes, clipboard and text utilities, completion parsing and the input echo model for the composer.      | https://github.com/google-gemini/gemini-cli                                                                                                                                  |
| pi                  | Tool and extension design research: subagent dispatch, team orchestration and long-context handling compared against `pi-subagents`, `@agimon-ai/po-team` and `billion-context`; featured entries in the plugin catalog and the subagent/team mechanisms were reviewed against these packages. | https://github.com/earendil-works/pi · https://pi.dev/packages/pi-subagents · https://pi.dev/packages/billion-context · https://pi.dev/packages/@agimon-ai/po-team?name=team |
| atomcode            | The WebUI command-output notice and the shared conversation input echo that keep terminal and browser views in sync.                                                                                                                                                                           | https://atomgit.com/atomgit_atomcode/atomcode                                                                                                                                |
| Claude Code plugins | Declarative plugin layout and marketplace format for skills, commands, hooks, agents and output styles.                                                                                                                                                                                        | https://docs.anthropic.com/en/docs/claude-code/plugins                                                                                                                       |

The vendored ZCode tree keeps its upstream notices; where TNT had to adapt a component to the local engine, the change is recorded in the divergence ledger. Third-party npm dependencies and their licenses are listed in the notices above.

## Contributors

TNT is a derivative work built on Continue, which pioneered an open-source coding agent.

## Code friends

<a href="https://github.com/linanwanttodo/TNT/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=linanwanttodo/TNT&max=500" />
</a>

## License

Apache 2.0 © 2023-2026 Continue Dev, Inc. and the respective upstream authors.
