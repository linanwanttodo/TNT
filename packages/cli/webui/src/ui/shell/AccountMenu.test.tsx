import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiPreferences } from "../../stores/ui-preferences.js";
import { AccountMenu } from "./AccountMenu.tsx";

describe("AccountMenu", () => {
  beforeEach(() => {
    useUiPreferences.setState({ theme: "dark", language: "en" });
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(cleanup);

  it("shows settings, theme, language and about", () => {
    render(<AccountMenu open onClose={() => {}} onOpenSettings={() => {}} />);

    expect(screen.getByText("TNT")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText("About")).toBeTruthy();
  });

  it("changes the theme and language", () => {
    render(<AccountMenu open onClose={() => {}} onOpenSettings={() => {}} />);

    fireEvent.click(screen.getByRole("menuitem", { name: /Theme/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));
    expect(useUiPreferences.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(screen.getByRole("menuitem", { name: /Language/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "中文" }));
    expect(useUiPreferences.getState().language).toBe("zh");
    expect(screen.getByText("设置")).toBeTruthy();
  });

  it("opens settings and the published site", () => {
    const onOpenSettings = vi.fn();
    const onClose = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <AccountMenu open onClose={onClose} onOpenSettings={onOpenSettings} />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /About/ }));
    expect(open).toHaveBeenCalledWith(
      "https://linanwanttodo.github.io/TNT/",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
