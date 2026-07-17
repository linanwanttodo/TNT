import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { useTerminalSize } from "./useTerminalSize.js";

function Consumer(): React.ReactElement {
  useTerminalSize(0);
  return <Text>x</Text>;
}

describe("useTerminalSize", () => {
  it("shares one resize listener across every consumer", () => {
    // The composer, status bar, banner and overlay all subscribe; one listener
    // each crossed Node's 10-listener default and printed its warning into the
    // running TUI, overwriting the composer.
    const { stdout, rerender, unmount } = render(<Consumer />);
    const oneConsumer = stdout.listenerCount("resize");

    rerender(
      <>
        {Array.from({ length: 12 }, (_, index) => (
          <Consumer key={index} />
        ))}
      </>,
    );

    expect(stdout.listenerCount("resize")).toBe(oneConsumer);

    unmount();
    expect(stdout.listenerCount("resize")).toBe(0);
  });
});
