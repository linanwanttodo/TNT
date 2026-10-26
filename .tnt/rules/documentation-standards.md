---
globs: "docs/**/*.{md,mdx}"
description: Style reference for consistency across the TNT documentation
alwaysApply: false
---

# TNT Documentation Style Guide

## Writing Tone & Voice

### Conversational and direct

- Follow Mintlify documentation standards.
- Use simple language that gets to the point.
- Prefer a plain term over jargon when the plain term is accurate.
- Write as if speaking to the developer sitting at the terminal.
- Keep paragraphs short enough to scan.

**Example:**
✅ "Type a request, press Enter, and it answers"
❌ "The system processes user queries and generates corresponding responses"

### Helpful and instructional

- Focus on what the reader accomplishes.
- Active voice and imperative mood for steps.
- Include the shortcut or flag that the step actually needs.
- Use admonition components for tips, warnings and caveats.

**Example:**
✅ "Press `Ctrl+O` to collapse every finished block"
❌ "Blocks can be collapsed by the user at any time"

### Practical and task-oriented

- Lead with the use case, then the mechanics.
- Ground explanations in a real command line, not a hypothetical.

## Content Structure

### Page organization

1. **Purpose first**: what the feature does and when to reach for it.
2. **Steps**: actionable, with the exact flag, key or config key.
3. **Surface-specific notes**: separate the interactive TUI, headless `-p`,
   `serve` and ACP whenever their behavior differs.
4. **Platform notes**: Linux, macOS and Windows only where they genuinely differ.
5. **Advanced or troubleshooting pointers**, linked rather than restated.

A GIF or screenshot belongs on a TUI page only when the layout is the thing being
explained; a terminal transcript usually says it better.

### Section headers

- Heading hierarchy starts at h2 (`##`).
- Frontmatter carries `title` and `description`; the description is 100-160 characters.
- Use "verb + object" headers: "Switch models mid-session", "Approve a write outside the workspace".
- Title case, kept short.

### Lists and steps

- Numbered lists for sequences, bullets for options.
- Keep list items parallel; start action items with a verb.

## Technical Writing Standards

### Code and keys

- Backticks for inline code, flags, config keys and paths.
- Write shortcuts as the terminal receives them: `Shift+Tab`, `Ctrl+C`, `Ctrl+V`.
- Windows and macOS differences go in the step or a note beside it, not a separate page.
- Configuration examples show a runnable `config.yaml` fragment with syntax highlighting.

### Cross-references

- Link with descriptive anchor text, relative to the docs root: `[permissions](/cli/permissions)`.
- Chinese pages link their Chinese twins (`/zh/cli/...`).
- Every added page appears in `docs/docs.json` and `docs/docs.zh.json`.

### Terminology

- **Stable terms**: the same word for the same thing throughout — "session",
  "turn", "tool call", "permission mode", "compaction".
- **Product name**: TNT. The command is `tnt`. Surfaces: the TUI, headless,
  `serve`, ACP. There is no IDE extension in this product; do not reintroduce one
  in the copy.
- **Feature names**: consistent capitalization for named things — Agent, Chat,
  Plan, and the tool names the CLI prints (`Read`, `Edit`, `ApplyPatch`, `Bash`).
- Model and provider names keep their vendor spelling (`DeepSeek`, `Moonshot`,
  `Anthropic`); they are configuration values, not product voice.

### Pronouns

- "you" for the reader, "it" for the tool or model, "we" only for the maintainers.
