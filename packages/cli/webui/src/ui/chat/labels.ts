/** Labels the chat view passes down; one stable object per locale. */
import type { MarkdownLabels } from "../primitives/markdown/render.tsx";

export const markdownLabels: MarkdownLabels = {
  code: {
    copyLabel: "Copy",
    copiedLabel: "Copied",
    toolbarLabels: {
      codeLabel: "Code",
      wrapLabel: "Wrap",
      unwrapLabel: "Unwrap",
    },
  },
  footnotes: "Footnotes",
};

export const chatLabels = {
  waiting: "Waiting for approval",
  allow: "Allow",
  reject: "Reject",
  reasoningTitle: "Thinking",
  sendLabel: "Send",
  stopLabel: "Stop",
  inputPlaceholder: "Describe a task or ask a question",
  autoModeSuggestion: "Turn on auto mode",
  attachLabel: "Attach a file",
  disconnected: "Connection lost — reconnecting…",
  inputAria: "Message input",
};
