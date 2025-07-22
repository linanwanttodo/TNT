import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, type Locale } from "../../i18n/index.js";

import { SubagentBreadcrumb } from "./SubagentBreadcrumb.js";

describe("SubagentBreadcrumb", () => {
  const originalLocale: Locale = getLocale();

  afterEach(() => {
    setLocale(originalLocale);
  });

  it("names the delegated agent and the parent session", () => {
    const { lastFrame } = render(
      <SubagentBreadcrumb
        subagentType="Explore"
        parentSessionId="parent-session"
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("subagent: Explore");
    expect(frame).toContain("parent-session");
    expect(frame).toContain("/back");
  });

  it("follows the active locale", () => {
    setLocale("zh-CN");

    const { lastFrame } = render(
      <SubagentBreadcrumb subagentType="Explore" parentSessionId="p" />,
    );

    expect(lastFrame() ?? "").toContain("子代理：Explore");
  });
});
