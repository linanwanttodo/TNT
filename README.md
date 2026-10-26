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

TNT is a coding agent that runs as a CLI: one engine driving the interactive terminal, headless runs, a local HTTP server, and ACP editors.

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/linanwanttodo/TNT/main/packages/cli/scripts/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/linanwanttodo/TNT/main/packages/cli/scripts/install.ps1 | iex
```

With Node.js 20 or newer, npm works too:

```bash
npm i -g @tnt/cli
```

Add a model to `~/.tnt/config.yaml`, then run `tnt` inside a repository. The
[quickstart](https://github.com/linanwanttodo/TNT/blob/main/docs/cli/quickstart.mdx)
takes it from there.

## Documentation

To learn how to configure TNT, how it works, and how to customize it, check out the [TNT Docs](https://github.com/linanwanttodo/TNT/tree/main/docs).

## Release

[![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://github.com/linanwanttodo/TNT) [![View source](https://img.shields.io/badge/View_source-181717?logo=github&logoColor=white)](packages/cli)

TNT builds on the final Continue 2.0.0 release and develops the CLI surface only. The editor extensions from that release have been removed.

## Contributors

TNT is a derivative work built on Continue, which pioneered an open-source coding agent.

## Code friends

<a href="https://github.com/linanwanttodo/TNT/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=linanwanttodo/TNT&max=500" />
</a>

## License

Apache 2.0 © 2023-2026 Continue Dev, Inc.
