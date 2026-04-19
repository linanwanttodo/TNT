# CLAUDE.md

This repository keeps its agent workspace in `.tnt/`, which is untracked: rules in
`.tnt/rules/`, prompts and checks beside them, the memory file at `.tnt/TNT.md`, and
project-level agent instructions at `.tnt/AGENTS.md` (each machine maintains its own).

Read these before working here:

- `.tnt/AGENTS.md` - monorepo layout, commands, and the guard-test culture (local file; if
  it is missing, the same guidance lives in `packages/cli/AGENTS.md` plus
  `packages/cli/ARCHITECTURE-tnt.md`)
- `packages/cli/AGENTS.md` - the CLI package's commands, layout and testing rules
- `docs/ARCHITECTURE-tnt.md` and `packages/cli/ARCHITECTURE-tnt.md` - the architecture
  reference and its rulings ledger
