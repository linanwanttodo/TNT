import { Text } from "ink";
import React from "react";
import stringWidth from "string-width";

import { closedThinkBlockPattern } from "../utils/thinkingTags.js";

import { hyperlink } from "./hyperlink.js";
import {
  defaultTheme,
  detectLanguage,
  highlightCode,
  SyntaxHighlighterTheme,
} from "./SyntaxHighlighter.js";
import { theme as uiTheme } from "./theme/tokens.js";
import { sanitizeTerminalText } from "./utils/terminalTextSafety.js";

interface MarkdownRendererProps {
  content: string | null | undefined;
  /**
   * Code highlight colours. Callers inside the theme provider pass the
   * active theme's syntax tokens so fenced blocks follow the theme; the
   * fallback keeps standalone use rendering on the dark baseline.
   */
  theme?: SyntaxHighlighterTheme;
}

interface MarkdownPattern {
  regex: RegExp;
  /**
   * What a match keeps as its text. The default takes the second capture when
   * there is one (a heading's text) and the first otherwise; a link needs its
   * label plus the target it will open.
   */
  contentOf?: (match: RegExpExecArray) => string;
  render: (content: string, key: string) => React.ReactNode;
}

/**
 * One pipe-table block. Detected before the inline patterns run, the way code
 * fences are: the inline regexes would eat the pipes and padding as emphasis
 * and code spans, and a table needs a column grid no inline pass can keep.
 */
interface TableBlock {
  index: number;
  length: number;
  header: string[];
  rows: string[][];
}

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim().replace(/\n/g, " "));
}

function findTableBlocks(text: string): TableBlock[] {
  const lines = text.split("\n");
  const tables: TableBlock[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const isTable = TABLE_LINE.test(line) && TABLE_DELIMITER.test(next);
    if (!isTable) {
      offset += line.length + 1;
      continue;
    }

    const header = splitRow(line);
    const rows: string[][] = [];
    let consumed = line.length + 1 + next.length + 1;
    let j = i + 2;
    while (j < lines.length && TABLE_LINE.test(lines[j])) {
      rows.push(splitRow(lines[j]));
      consumed += lines[j].length + 1;
      j++;
    }
    tables.push({ index: offset, length: consumed, header, rows });
    for (let k = i; k < j; k++) {
      offset += lines[k].length + 1;
    }
    i = j - 1;
  }
  return tables;
}

/**
 * Renders the grid with display-width padding so CJK cells line up. The frame
 * is the theme's subtle colour and the header is bold. A table wider than the
 * terminal truncates its cells, because a wrapped grid stops being a grid.
 */
function renderTable(block: TableBlock, key: string): React.ReactNode {
  const columns = Math.max(
    block.header.length,
    ...block.rows.map((row) => row.length),
  );
  const cell = (row: string[], index: number) => row[index] ?? "";
  const overhead = 2 * columns + columns + 1;
  const available = Math.max(12, (process.stdout.columns ?? 80) - 4);
  const budget = Math.max(2, Math.floor((available - overhead) / columns));

  const widths = Array.from({ length: columns }, (_, index) => {
    const widest = Math.max(
      stringWidth(cell(block.header, index)),
      0,
      ...block.rows.map((row) => stringWidth(cell(row, index))),
    );
    return Math.min(Math.max(widest, 2), budget);
  });

  const truncate = (value: string, width: number) => {
    if (stringWidth(value) <= width) return value;
    let out = "";
    for (const char of value) {
      if (stringWidth(out + char) > width - 1) break;
      out += char;
    }
    return out + "\u2026";
  };
  const pad = (value: string, width: number) =>
    truncate(value, width) +
    " ".repeat(Math.max(0, width - stringWidth(truncate(value, width))));
  const rule = (left: string, mid: string, right: string) =>
    left + widths.map((width) => "\u2500".repeat(width + 2)).join(mid) + right;
  const line = (row: string[], bold: boolean) => {
    const text =
      "\u2502" +
      row
        .map((value, index) => ` ${pad(value, widths[index])} `)
        .join("\u2502") +
      "\u2502";
    return (
      <Text key={`${key}-r${bold ? "h" : "b"}`} bold={bold}>
        {text + "\n"}
      </Text>
    );
  };

  const headerRow = Array.from({ length: columns }, (_, index) =>
    cell(block.header, index),
  );

  return (
    <Text key={key}>
      <Text color={uiTheme.text.subtle}>
        {rule("\u250c", "\u252c", "\u2510") + "\n"}
      </Text>
      {line(headerRow, true)}
      <Text color={uiTheme.text.subtle}>
        {rule("\u251c", "\u253c", "\u2524") + "\n"}
      </Text>
      {block.rows.map((row) =>
        line(
          Array.from({ length: columns }, (_, cellIndex) =>
            cell(row, cellIndex),
          ),
          false,
        ),
      )}
      <Text color={uiTheme.text.subtle}>
        {rule("\u2514", "\u2534", "\u2518")}
      </Text>
    </Text>
  );
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(
  ({ content: untrusted, theme = defaultTheme }) => {
    // Everything this renders can come from a tool, a file or the network,
    // and an escape inside it would be executed by the terminal rather than
    // shown. Colour survives; anything that commands the terminal does not.
    const content =
      untrusted === null || untrusted === undefined
        ? untrusted
        : sanitizeTerminalText(untrusted);
    const patterns: MarkdownPattern[] = [
      {
        regex: /```(?:(\w+)\n)?([\s\S]*?)```/g,
        render: (_content, _key) => {
          // content here is the captured group, but we need to parse the full match
          return null; // This will be handled separately
        },
      },
      {
        regex: closedThinkBlockPattern(),
        render: (content, key) => (
          <Text key={key} color={uiTheme.text.secondary} italic>
            {content.trim()}
          </Text>
        ),
      },
      {
        regex: /^(#{1,6})\s+(.+)$/gm,
        render: (content, key) => (
          <Text key={key} bold>
            {content}
          </Text>
        ),
      },
      {
        // Links render as the label, linked where the terminal understands it:
        // the label is what a reader quotes, and the URL is a keystroke away in
        // the terminals that do understand OSC 8.
        regex: /\[([^\]]+)\]\(([^)\s]+)\)/g,
        contentOf: (link) => hyperlink(link[1], link[2]),
        render: (content, key) => (
          <Text key={key} color={uiTheme.accent} underline>
            {content}
          </Text>
        ),
      },
      {
        regex: /\*\*(.+?)\*\*/g,
        render: (content, key) => (
          <Text key={key} bold>
            {content}
          </Text>
        ),
      },
      {
        regex: /\*([^\s*][^*]*[^\s*]|[^\s*])\*/g,
        render: (content, key) => (
          <Text key={key} italic>
            {content}
          </Text>
        ),
      },
      {
        regex: /_([^_]+)_/g,
        render: (content, key) => (
          <Text key={key} italic>
            {content}
          </Text>
        ),
      },
      {
        regex: /~~([^~]+)~~/g,
        render: (content, key) => (
          <Text key={key} strikethrough>
            {content}
          </Text>
        ),
      },
      {
        regex: /`([^`\n]+)`/g,
        render: (content, key) => (
          <Text key={key} color={uiTheme.accent}>
            {content}
          </Text>
        ),
      },
      {
        // A bare URL in a command's answer is a place to go: it becomes a
        // terminal hyperlink the same way a written link does, so a wrapped
        // address still opens with a click.
        regex: /(?<![(\w])https?:\/\/[^\s)\]]+/g,
        contentOf: (match) => hyperlink(match[0], match[0]),
        render: (content, key) => (
          <Text key={key} color={uiTheme.accent} underline>
            {content}
          </Text>
        ),
      },
    ];

    const renderMarkdown = (text: string | null | undefined) => {
      const parts: React.ReactNode[] = [];

      // Handle null/undefined text
      if (!text) {
        return parts;
      }

      let currentIndex = 0;

      // Tables come before everything: the pipe syntax collides with the
      // inline emphasis and code patterns, and the grid needs whole rows.
      const tables = findTableBlocks(text);

      // First, handle code blocks separately
      const codeBlockRegex = /```(?:(\w+)\n)?([\s\S]*?)```/g;
      const codeBlocks: Array<{
        index: number;
        length: number;
        language: string;
        code: string;
      }> = [];

      let codeMatch;
      while ((codeMatch = codeBlockRegex.exec(text)) !== null) {
        const language = codeMatch[1] || detectLanguage(codeMatch[2]);
        codeBlocks.push({
          index: codeMatch.index,
          length: codeMatch[0].length,
          language,
          code: codeMatch[2].trim(),
        });
      }

      // Find all matches for other patterns (excluding code blocks)
      const allMatches: Array<{
        index: number;
        length: number;
        content: string;
        render: (content: string, key: string) => React.ReactNode;
      }> = [];

      patterns.slice(1).forEach((pattern) => {
        // Skip the first pattern (code blocks)
        let match: RegExpExecArray | null;
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

        while ((match = regex.exec(text)) !== null) {
          // Skip if this match is inside a code block
          const isInCodeBlock = codeBlocks.some(
            (block) =>
              match!.index >= block.index &&
              match!.index < block.index + block.length,
          );
          const isInTable = tables.some(
            (block) =>
              match!.index >= block.index &&
              match!.index < block.index + block.length,
          );

          if (!isInCodeBlock && !isInTable) {
            allMatches.push({
              index: match.index,
              length: match[0].length,
              content: pattern.contentOf?.(match) ?? (match[2] || match[1]),
              render: pattern.render,
            });
          }
        }
      });

      // Combine tables, code blocks and other matches
      const combinedMatches: Array<{
        index: number;
        length: number;
        type: "code" | "other" | "table";
        content?: string;
        render?: (content: string, key: string) => React.ReactNode;
        language?: string;
        code?: string;
        table?: TableBlock;
      }> = [
        ...tables.map((block) => ({
          index: block.index,
          length: block.length,
          type: "table" as const,
          table: block,
        })),
        ...codeBlocks.map((block) => ({
          index: block.index,
          length: block.length,
          type: "code" as const,
          language: block.language,
          code: block.code,
        })),
        ...allMatches.map((match) => ({
          index: match.index,
          length: match.length,
          type: "other" as const,
          content: match.content,
          render: match.render,
        })),
      ];

      // Sort matches by index to process them in order
      combinedMatches.sort((a, b) => a.index - b.index);

      // Process matches, avoiding overlaps
      const processedMatches: typeof combinedMatches = [];
      for (const match of combinedMatches) {
        const overlaps = processedMatches.some(
          (processed) =>
            (match.index >= processed.index &&
              match.index < processed.index + processed.length) ||
            (processed.index >= match.index &&
              processed.index < match.index + match.length),
        );

        if (!overlaps) {
          processedMatches.push(match);
        }
      }

      // Render the text with formatting
      processedMatches.forEach((match, idx) => {
        // Add text before this match
        if (match.index > currentIndex) {
          parts.push(text.slice(currentIndex, match.index));
        }

        // Add the formatted match
        if (match.type === "table") {
          if (match.index > currentIndex && text[currentIndex - 1] !== "\n") {
            parts.push("\n");
          }
          parts.push(renderTable(match.table!, `table-${idx}-${match.index}`));
          parts.push("\n");
        } else if (match.type === "code") {
          const highlightedCode = highlightCode(
            match.code!,
            match.language!,
            theme,
          );
          parts.push(
            <Text key={`code-${idx}-${match.index}`}>{highlightedCode}</Text>,
          );
        } else {
          parts.push(
            match.render!(match.content!, `format-${idx}-${match.index}`),
          );
        }

        currentIndex = match.index + match.length;
      });

      // Add remaining text
      if (currentIndex < text.length) {
        parts.push(text.slice(currentIndex));
      }

      return parts;
    };

    return <Text>{renderMarkdown(content)}</Text>;
  },
);

MarkdownRenderer.displayName = "MarkdownRenderer";

export { defaultTheme, MarkdownRenderer };
export type { SyntaxHighlighterTheme };
