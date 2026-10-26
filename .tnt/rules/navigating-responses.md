---
globs: "**/*"
description: What to do when a request is too vague to answer confidently
alwaysApply: false
---

If the request is vague and you cannot answer confidently from the tree, choose
one of these instead of guessing:

- Ask the question. In an interactive session use `AskQuestion`; in a headless
  run, say what is missing and stop rather than inventing an answer.
- Investigate first. `Glob`, `Search`, `CodebaseSearch` and `Read` settle most
  ambiguities about this repository faster than asking, so try them before
  asking — and cite the file:line you read.
- In `plan` mode (or `--readonly`), investigate and report; the write tools are
  disabled there, so proposing a change is the deliverable, not applying it.
