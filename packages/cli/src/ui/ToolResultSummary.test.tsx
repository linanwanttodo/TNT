import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLocale, setLocale } from "../i18n/index.js";
import {
  MARKER_FILE_CREATED,
  MARKER_PERMISSION_DENIED,
} from "../tools/resultMarkers.js";

import { ToolResultSummary } from "./ToolResultSummary.js";

let previousLocale: string;

beforeEach(() => {
  previousLocale = getLocale();
  setLocale("en");
});

afterEach(() => {
  setLocale(previousLocale as never);
});

function frameFor(toolName: string, content: string): string {
  const tree = render(
    <ToolResultSummary toolName={toolName} content={content} />,
  );
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("tool result summary labels", () => {
  it("labels a created file from the marker the tool writes", () => {
    const frame = frameFor("Write", `${MARKER_FILE_CREATED}: /tmp/a.ts`);

    expect(frame).toContain("File created successfully");
  });

  it("labels an updated file when the marker is absent", () => {
    const frame = frameFor("Write", "Successfully wrote to file: /tmp/a.ts");

    expect(frame).toContain("File updated successfully");
  });

  it("labels a cancellation from the marker the stream writes", () => {
    // Tools with a renderer of their own never reach this summary, so the
    // marker path is exercised through a tool that falls through to it.
    const frame = frameFor("UploadArtifact", MARKER_PERMISSION_DENIED);

    expect(frame).toContain("Cancelled by user");
  });

  it("shows the raw result for a tool with its own renderer", () => {
    const frame = frameFor("Bash", MARKER_PERMISSION_DENIED);

    expect(frame).toContain("Permission denied by user");
  });

  it("counts items and matches for the list and search tools", () => {
    expect(frameFor("List", "one\ntwo\nthree")).toContain("Listed 3 items");
    expect(frameFor("List", "only")).toContain("Listed 1 item");
    expect(frameFor("Search", "a\nb")).toContain("Found 2 matches");
  });

  it("follows the selected locale", () => {
    setLocale("zh-CN");

    expect(frameFor("Write", `${MARKER_FILE_CREATED}: /tmp/a.ts`)).toContain(
      "文件创建成功",
    );
    expect(frameFor("UploadArtifact", MARKER_PERMISSION_DENIED)).toContain(
      "已被用户取消",
    );
  });
});
