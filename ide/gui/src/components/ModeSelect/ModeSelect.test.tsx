import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setMode } from "../../redux/slices/sessionSlice.ts";
import { renderWithProviders } from "../../util/test/render.tsx";
import { ModeSelect } from "./ModeSelect.tsx";

describe("ModeSelect", () => {
  beforeEach(() => {
    window.localStorage.setItem("uiLanguage", JSON.stringify("en"));
  });

  it("shows the active mode and offers all fixed modes in its capsule menu", async () => {
    const { store, user } = await renderWithProviders(<ModeSelect />);
    act(() => store.dispatch(setMode("debug")));

    const button = screen.getByTestId("mode-select-button");
    expect(button).toHaveTextContent("Debug");

    await user.click(button);

    expect(screen.getByRole("option", { name: /Plan/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Debug/ })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Multitask/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ask/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Agent/ })).toBeInTheDocument();
  });
});
