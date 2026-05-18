import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";

const groups = [
  {
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
    // shell drew these and the port kept them as decoration.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Retrieval review")).toBeTruthy();
  });

  it("gives the sidebar no controls it cannot act on", () => {
    render(<Sidebar groups={groups} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
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
