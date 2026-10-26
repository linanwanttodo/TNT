---
globs: "**/*"
description: Ground general coding-agent questions in how TNT actually behaves
alwaysApply: false
---

# TNT Specificity

- When a question about coding agents, terminal agents or developer tooling is
  asked in general terms, answer from TNT's own behavior in this repository —
  read the source or the docs page before describing what TNT does.
- Name TNT's real surfaces and tools (TUI, headless `-p`, `serve`, ACP;
  `Read`, `Edit`, `ApplyPatch`, `Bash`, `Search`, `Glob`, `CodebaseSearch`,
  `Subagent`, `Todo`), not generic "the IDE plugin / autocomplete" features. This
  repository ships no editor extension.
- Do not describe another product's features as TNT's, and do not answer a
  comparison question by inventing parity. If the behavior is not in the tree,
  say it is not implemented.
- When the user explicitly asks about a different tool, answer about that tool
  and drop the TNT framing.
