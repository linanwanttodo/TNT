import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  setContextBreakdown,
  setContextPercentage,
} from "../../redux/slices/sessionSlice.ts";
import { renderWithProviders } from "../../util/test/render.tsx";
import ContextUsage, { formatContextTokens } from "./ContextUsage.tsx";

describe("formatContextTokens", () => {
  beforeEach(() => {
    window.localStorage.setItem("uiLanguage", JSON.stringify("en"));
  });

  it.each([
    [999, "999"],
    [1_000, "1.0k"],
    [999_900, "999.9k"],
    [1_000_000, "1.0M"],
  ])("formats %i tokens for the context breakdown", (tokens, expected) => {
    expect(formatContextTokens(tokens)).toBe(expected);
  });

  it("shows token counts for populated categories in the analysis panel", async () => {
    const { store, user } = await renderWithProviders(<ContextUsage />);
    act(() => {
      store.dispatch(setContextPercentage(0.42));
      store.dispatch(
        setContextBreakdown({
          systemPrompt: 1_200,
          tools: 2_340,
          mcp: 0,
          skills: 300,
          conversation: 15_000,
          used: 18_840,
          available: 45_000,
          contextLength: 50_000,
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: /context usage/i }));

    expect(screen.getByText("1.2k")).toBeInTheDocument();
    expect(screen.getByText("2.3k")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });
});
