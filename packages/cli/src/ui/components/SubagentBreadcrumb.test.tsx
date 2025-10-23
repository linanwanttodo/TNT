import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, type Locale } from "../../i18n/index.js";

import { SubagentBreadcrumb } from "./SubagentBreadcrumb.js";

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("SubagentBreadcrumb", () => {
  const originalLocale: Locale = getLocale();

  afterEach(() => {
    setLocale(originalLocale);
  });

  it("names the delegated agent and the parent session", () => {
    const frame = frameOf(
      <SubagentBreadcrumb
        subagentType="Explore"
        parentSessionId="parent-session"
      />,
    );

    expect(frame).toContain("subagent: Explore");
    expect(frame).toContain("parent-session");
    expect(frame).toContain("/back");
  });

  it("follows the active locale", () => {
    setLocale("zh-CN");

    expect(
      frameOf(
        <SubagentBreadcrumb subagentType="Explore" parentSessionId="p" />,
      ),
    ).toContain("子代理：Explore");
  });
});
