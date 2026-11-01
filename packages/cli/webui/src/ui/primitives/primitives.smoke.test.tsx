import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./Button.tsx";
import { JsonTree } from "./JsonTree.tsx";
import { Modal } from "./Modal.tsx";
import { StateDot } from "./StateDot.tsx";

const jsonLabels = {
  copyValue: "Copy value",
  copyJson: "Copy JSON",
  copyPath: "Copy path",
  copyPrettyJson: "Copy pretty JSON",
  copyCompactJson: "Copy compact JSON",
  copied: "Copied",
  copyFailed: "Copy failed",
  collapseNode: "Collapse",
  expandNode: "Expand",
  copyButtonTitle: (action: string) => action,
};

describe("ported primitives smoke render", () => {
  afterEach(cleanup);

  it("renders a labeled button", () => {
    render(<Button variant="primary">send</Button>);
    expect(screen.getByRole("button", { name: "send" })).toBeTruthy();
  });

  it("renders a modal with its title in a dialog", () => {
    render(
      <Modal open onClose={() => {}} title="Confirm" closeLabel="Close">
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });

  it("renders a JSON tree from object data", () => {
    const { container } = render(
      <JsonTree data={{ tool: "bash" }} label="tool" labels={jsonLabels} />,
    );
    expect(container.textContent).toContain("bash");
  });

  it("renders a state dot with its state attribute", () => {
    const { container } = render(<StateDot state="ongoing" />);
    expect(container.querySelector("[data-state='ongoing']")).toBeTruthy();
  });
});
