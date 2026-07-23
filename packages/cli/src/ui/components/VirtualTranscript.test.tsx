import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { ScrollViewMetrics } from "./ScrollView.js";
import { VirtualTranscript, type VirtualItem } from "./VirtualTranscript.js";

const rendered = new Set<number>();

function Probe({ index }: { index: number }) {
  rendered.add(index);
  return <Text>{`line ${index}`}</Text>;
}

function items(count: number): VirtualItem[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `item-${index}`,
    node: <Probe index={index} />,
    estimate: 1,
  }));
}

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

describe("VirtualTranscript", () => {
  it("mounts only the rows near the window and reports full content height", async () => {
    rendered.clear();
    const onMetrics = vi.fn<(metrics: ScrollViewMetrics) => void>();
    const tree = render(
      <Box height={10} flexDirection="column">
        <VirtualTranscript
          items={items(100)}
          scrollTop={50}
          onMetrics={onMetrics}
        />
      </Box>,
    );

    try {
      await tick();
      const frame = tree.lastFrame() ?? "";
      expect(frame.split("\n")[0]).toBe("line 50");
      expect(onMetrics.mock.lastCall?.[0]).toEqual({
        contentHeight: 100,
        viewportHeight: 10,
      });
      // Overscan keeps a screen above and below, but nothing near the ends.
      expect(rendered.has(0)).toBe(false);
      expect(rendered.has(99)).toBe(false);
      // The first commit uses an assumed viewport and mounts its window; the
      // measured commit narrows it. Neither is the whole list.
      expect(rendered.size).toBeLessThan(60);
      expect([...rendered].every((index) => index >= 30 && index <= 90)).toBe(
        true,
      );
    } finally {
      tree.unmount();
    }
  });

  it("paints the tail from the end even when earlier heights are estimates", async () => {
    const onMetrics = vi.fn<(metrics: ScrollViewMetrics) => void>();
    const tree = render(
      <Box height={10} flexDirection="column">
        <VirtualTranscript
          items={items(100)}
          scrollTop={90}
          onMetrics={onMetrics}
        />
      </Box>,
    );

    try {
      await tick();
      const frame = tree.lastFrame() ?? "";
      expect(frame.split("\n").at(-1)).toBe("line 99");
    } finally {
      tree.unmount();
    }
  });

  it("does not re-render every row when the offset moves", async () => {
    rendered.clear();
    const onMetrics = vi.fn();
    const App = ({ top }: { top: number }) => (
      <Box height={10} flexDirection="column">
        <VirtualTranscript
          items={items(400)}
          scrollTop={top}
          onMetrics={onMetrics}
        />
      </Box>
    );

    const tree = render(<App top={100} />);
    try {
      await tick();
      rendered.clear();
      tree.rerender(<App top={103} />);
      await tick();
      expect(rendered.size).toBeLessThan(40);
    } finally {
      tree.unmount();
    }
  });
});
