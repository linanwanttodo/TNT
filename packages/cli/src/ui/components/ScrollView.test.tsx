import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { ScrollView, type ScrollViewMetrics } from "./ScrollView.js";

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => (
    <Text key={index}>{`line ${index}`}</Text>
  ));

describe("ScrollView", () => {
  it("clips its children to the parent height and applies a row offset", async () => {
    const { lastFrame, unmount } = render(
      <Box height={10} flexDirection="column">
        <ScrollView scrollTop={5} onMetrics={vi.fn()}>
          {lines(40)}
        </ScrollView>
      </Box>,
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const frame = lastFrame() ?? "";

      expect(frame.split("\n")).toHaveLength(10);
      expect(frame.startsWith("line 5\n")).toBe(true);
      expect(frame.endsWith("line 14")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("reports the measured content and viewport heights", async () => {
    const onMetrics = vi.fn<(metrics: ScrollViewMetrics) => void>();
    const { unmount } = render(
      <Box height={10} flexDirection="column">
        <ScrollView scrollTop={0} onMetrics={onMetrics}>
          {lines(40)}
        </ScrollView>
      </Box>,
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(onMetrics).toHaveBeenCalled();
      expect(onMetrics.mock.lastCall?.[0]).toEqual({
        contentHeight: 40,
        viewportHeight: 10,
      });
    } finally {
      unmount();
    }
  });
});
