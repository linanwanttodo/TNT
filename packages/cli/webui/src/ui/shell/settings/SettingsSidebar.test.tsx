import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { SettingsSidebar } from "./SettingsSidebar.tsx";

describe("SettingsSidebar", () => {
  beforeEach(() => {
    useUiPreferences.setState({ language: "en", theme: "dark" });
  });

  afterEach(cleanup);

  it("renders the Settings navigation and marks the active section", () => {
    render(
      <SettingsSidebar
        activeSection="skills"
        onSelectSection={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText("Settings")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Skills/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("button", { name: /Plugins/ })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("selects a section and goes back to chat", () => {
    const onSelectSection = vi.fn();
    const onBack = vi.fn();
    render(
      <SettingsSidebar
        activeSection="plugins"
        onSelectSection={onSelectSection}
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /MCP/ }));
    expect(onSelectSection).toHaveBeenCalledWith("mcp");

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(onBack).toHaveBeenCalled();
  });
});
