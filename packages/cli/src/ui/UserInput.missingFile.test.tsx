import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveWithin } from "../utils/pathGuard.js";

const root = path.join(os.tmpdir(), "tnt-test-missing-file");

// Test the missing file handling logic directly
describe("UserInput - Missing File Handling", () => {
  beforeEach(() => {
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("should handle selecting non-existent files gracefully", async () => {
    const mockOnFileAttached = vi.fn();

    // Simulate the selectFile logic for a missing file
    const filePath = path.join(root, "missing-file.txt");

    try {
      const fsPromises = await import("fs/promises");
      const absolutePath = resolveWithin(root, filePath);
      const content = await fsPromises.readFile(absolutePath, "utf-8");
      mockOnFileAttached(absolutePath, content);
    } catch (error) {
      // If file doesn't exist, just attach the filename without content
      if (error instanceof Error && (error as any).code === "ENOENT") {
        const absolutePath = resolveWithin(root, filePath);
        mockOnFileAttached(absolutePath, filePath); // Just the filename for missing file
      } else {
        console.error(`Error reading file ${filePath}:`, error);
      }
    }

    // Should have called onFileAttached with filename as content
    expect(mockOnFileAttached).toHaveBeenCalledWith(filePath, filePath);
  });
});
