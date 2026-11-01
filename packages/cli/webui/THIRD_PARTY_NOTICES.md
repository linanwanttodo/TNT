# Third-party notices

Portions of this frontend are adapted from DSH (DeepSeek UI component library),
which is distributed under the MIT License.

Adapted sources:

- `src/ui/primitives/` - UI primitives ported from `@deepseek-ai/dsh-ui-primitives`
  (Button, Modal, JsonTree, DiffBlock, TerminalBlock, Tooltip, Toast, Markdown
  renderer, icons, and helpers), simplified and rewired for this project.
- `src/ui/theme/base.css`, `scrollbar.css`, `shiki.css`, `focus.css`,
  `corner-shape.css` - theme stylesheets ported from `@deepseek-ai/dsh-ui-theme`.
- `src/ui/primitives/code-language.ts`, `src/ui/primitives/file-drag.ts` -
  utilities ported from dsh util packages.

The claude-style design tokens in `src/ui/theme/tokens.css` follow the
`dsh-claude-style` plugin's documented palette (also MIT, from the DSH project).

MIT License

Copyright (c) 2025 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
