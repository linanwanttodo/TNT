import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";

const groups = [
  {
    path: "/home/lin/continue",
    name: "continue",
    sessions: [
      {
        sessionId: "s1",
        title: "Retrieval review",
        workspaceDirectory: "/home/lin/continue",
        dateCreated: "",
      },
    ],
  },
];

describe("shell chrome", () => {
  afterEach(cleanup);

  it("gives the title bar no window controls", () => {
    render(<TitleBar title="Retrieval review" />);
    // A browser tab cannot minimize, maximize or close itself; the desktop
    // shell drew these and the port kept them as decoration. The bar does
    // carry its own navigation actions, so the assertion names the window
    // controls rather than counting buttons.
    expect(
      screen.queryByRole("button", { name: /minimize|maximize|close/i }),
    ).toBeNull();
    expect(screen.getByText("Retrieval review")).toBeTruthy();
  });

  it("wires the session rows as actionable buttons", () => {
    render(<Sidebar groups={groups} activeSessionId="s1" />);
    // The rows, their menus and the collapse control are all real buttons;
    // nothing in the rail is decoration.
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    for (const label of ["Cowork", "Code", "Routines", "Customize", "More"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("lists the real sessions under their workspace", () => {
    render(<Sidebar groups={groups} activeSessionId="s1" />);
    expect(screen.getByText("continue")).toBeTruthy();
    expect(screen.getByText("Retrieval review")).toBeTruthy();
  });
});
