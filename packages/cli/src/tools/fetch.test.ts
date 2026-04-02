import type { ContextItem } from "core/index.js";
import { fetchUrlContentImpl } from "core/tools/implementations/fetchUrlContent.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTool } from "./fetch.js";
import { clearFetchCache } from "./fetchCache.js";

// Mock the core fetchUrlContent implementation
vi.mock("core/tools/implementations/fetchUrlContent.js", () => ({
  fetchUrlContentImpl: vi.fn(),
}));

const mockFetchUrlContentImpl = vi.mocked(fetchUrlContentImpl);

describe("fetchTool", () => {
  let originalConsoleError: typeof console.error;

  let originalMaxChars: string | undefined;

  const page = (content: string): ContextItem[] => [
    {
      name: "Page",
      description: "https://example.com",
      content,
      uri: { type: "url", value: "https://example.com" },
    },
  ];

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = vi.fn();
    originalMaxChars = process.env.TNT_FETCH_MAX_OUTPUT_LENGTH;
    mockFetchUrlContentImpl.mockReset();
    // The cache is in-process and keyed by URL, and every case here reads
    // `https://example.com`: without this, one case would answer another.
    clearFetchCache();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    if (originalMaxChars === undefined) {
      delete process.env.TNT_FETCH_MAX_OUTPUT_LENGTH;
    } else {
      process.env.TNT_FETCH_MAX_OUTPUT_LENGTH = originalMaxChars;
    }
    clearFetchCache();
  });

  it("should return clean content from successful fetch", async () => {
    const mockContextItems: ContextItem[] = [
      {
        name: "Example Page",
        description: "https://example.com",
        content:
          "# Example Page\n\nThis is some example content from a webpage.",
        uri: { type: "url", value: "https://example.com" },
      },
    ];

    mockFetchUrlContentImpl.mockResolvedValue(mockContextItems);

    const result = await fetchTool.run({ url: "https://example.com" });

    expect(result).toBe(
      "# Example Page\n\nThis is some example content from a webpage.",
    );
    expect(mockFetchUrlContentImpl).toHaveBeenCalledWith(
      { url: "https://example.com" },
      { fetch },
    );
  });

  it("should filter out truncation warnings from core implementation", async () => {
    const mockContextItems: ContextItem[] = [
      {
        name: "Long Page",
        description: "https://example.com",
        content: "This is the main content that was truncated.",
        uri: { type: "url", value: "https://example.com" },
      },
      {
        name: "Truncation warning",
        description: "",
        content:
          "The content from https://example.com was truncated because it exceeded the 20000 character limit.",
      },
    ];

    mockFetchUrlContentImpl.mockResolvedValue(mockContextItems);

    const result = await fetchTool.run({ url: "https://example.com" });

    // Truncation warnings are filtered out - only the main content is returned
    expect(result).toBe("This is the main content that was truncated.");
  });

  it("should handle multiple content items", async () => {
    const mockContextItems: ContextItem[] = [
      {
        name: "Page 1",
        description: "https://example.com",
        content: "Content from page 1",
        uri: { type: "url", value: "https://example.com" },
      },
      {
        name: "Page 2",
        description: "https://example.com",
        content: "Content from page 2",
        uri: { type: "url", value: "https://example.com" },
      },
    ];

    mockFetchUrlContentImpl.mockResolvedValue(mockContextItems);

    const result = await fetchTool.run({ url: "https://example.com" });

    expect(result).toBe("Content from page 1\n\nContent from page 2");
  });

  it("should throw error when no content items returned", async () => {
    mockFetchUrlContentImpl.mockResolvedValue([]);

    await expect(fetchTool.run({ url: "https://example.com" })).rejects.toThrow(
      "Could not fetch content from https://example.com",
    );
  });

  it("should throw errors from core implementation", async () => {
    const error = new Error("Network error");
    mockFetchUrlContentImpl.mockRejectedValue(error);

    await expect(fetchTool.run({ url: "https://example.com" })).rejects.toThrow(
      "Error: Network error",
    );
  });

  it("should call fetchUrlContentImpl with correct arguments", async () => {
    const mockContextItems: ContextItem[] = [
      {
        name: "Test Page",
        description: "https://example.com",
        content: "Test content",
        uri: { type: "url", value: "https://example.com" },
      },
    ];

    mockFetchUrlContentImpl.mockResolvedValue(mockContextItems);

    await fetchTool.run({ url: "https://example.com" });

    expect(mockFetchUrlContentImpl).toHaveBeenCalledWith(
      { url: "https://example.com" },
      { fetch },
    );
  });

  it("should have correct tool metadata", () => {
    expect(fetchTool.name).toBe("Fetch");
    expect(fetchTool.displayName).toBe("Fetch");
    // The wording itself is guarded in toolGuidance.test.ts; this test owns the
    // metadata, so it checks that the copy still describes this tool rather than
    // pinning a sentence that any copy edit would break.
    expect(fetchTool.description).toContain("markdown");
    expect(fetchTool.description).toContain("one URL per call");
    expect(fetchTool.readonly).toBe(true);
    expect(fetchTool.isBuiltIn).toBe(true);
    expect(fetchTool.parameters).toEqual({
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch content from",
        },
        offset: {
          type: "integer",
          description:
            "Character offset to start reading from, zero or more; use the value the previous result reported",
        },
      },
    });
  });

  it("should provide correct preview in preprocess", async () => {
    const args = { url: "https://example.com" };
    const result = await fetchTool.preprocess?.(args);

    expect(result).toEqual({
      preview: [
        {
          type: "text",
          content: "Will fetch: https://example.com",
        },
      ],
      args,
    });
  });

  describe("paging and caching", () => {
    // The file's own beforeEach resets the mock and clears the cache, which is
    // what keeps these cases from answering each other.
    beforeEach(() => {
      process.env.TNT_FETCH_MAX_OUTPUT_LENGTH = "10";
    });

    const fetchPage = (content: string) =>
      mockFetchUrlContentImpl.mockResolvedValue([
        {
          name: "Page",
          description: "https://example.com",
          content,
          uri: { type: "url", value: "https://example.com" },
        },
      ]);

    it("returns one page and says where the next one starts", async () => {
      fetchPage("abcdefghijklmnopqrstuvwxyz");

      const first = await fetchTool.run({ url: "https://example.com" });

      expect(first).toBe(
        "abcdefghij\n\n[characters 0-10 of 26; fetch again with offset 10 for the rest]",
      );
      const second = await fetchTool.run({
        url: "https://example.com",
        offset: 10,
      });
      expect(second).toContain("klmnopqrst");
      expect(second).toContain("offset 20");
    });

    it("answers a page read again from the cache", async () => {
      fetchPage("short page");

      const first = await fetchTool.run({ url: "https://example.com" });
      const second = await fetchTool.run({ url: "https://example.com" });

      expect(second).toBe(first);
      expect(mockFetchUrlContentImpl).toHaveBeenCalledTimes(1);
    });

    it("says how much the page had when the offset is past its end", async () => {
      fetchPage("short");

      const result = await fetchTool.run({
        url: "https://example.com",
        offset: 99,
      });

      expect(result).toBe(
        "[no content at offset 99: the page has 5 characters]",
      );
    });

    it("reads from the start when the offset is not a whole number", async () => {
      fetchPage("abcdefghijklmnopqrstuvwxyz");

      const result = await fetchTool.run({
        url: "https://example.com",
        // A model that guesses a fractional offset still gets the page, not an error.
        offset: 3.5,
      });

      expect(result).toContain("abcdefghij");
    });

    it("does not remember a fetch that failed", async () => {
      mockFetchUrlContentImpl.mockRejectedValue(new Error("network down"));

      await expect(
        fetchTool.run({ url: "https://example.com" }),
      ).rejects.toThrow("network down");
      await expect(
        fetchTool.run({ url: "https://example.com" }),
      ).rejects.toThrow("network down");
      expect(mockFetchUrlContentImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe("the URL guard", () => {
    it("refuses before it reaches the network or the cache", async () => {
      const rejected = fetchTool.run({ url: "file:///etc/passwd" });

      await expect(rejected).rejects.toThrow(/http and https/);
      await expect(
        fetchTool.run({ url: "file:///etc/passwd" }),
      ).rejects.toThrow(/http and https/);
      expect(mockFetchUrlContentImpl).not.toHaveBeenCalled();
    });
  });
});
