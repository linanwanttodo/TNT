import fs from "fs";
import path from "path";

import { env } from "../config/env.js";

import { InputHistory } from "./inputHistory.js";

// The history file lives in the per-worker temp global dir, so the suite
// exercises the real read and write path rather than a mocked fs.
const HISTORY_FILE = path.join(env.continueHome, "input_history.json");

describe("InputHistory", () => {
  let inputHistory: InputHistory;

  beforeEach(() => {
    fs.rmSync(HISTORY_FILE, { force: true });
    inputHistory = new InputHistory();
  });

  describe("navigation with typed input preservation", () => {
    beforeEach(() => {
      // Add some history entries
      inputHistory.addEntry("first command");
      inputHistory.addEntry("second command");
    });

    it("should preserve typed input when navigating history", () => {
      const typedInput = "user typed this";

      // User types something then presses up arrow
      const historyEntry1 = inputHistory.navigateUp(typedInput);
      expect(historyEntry1).toBe("second command");

      // Then presses down arrow - should get back their typed input
      const returnedInput = inputHistory.navigateDown();
      expect(returnedInput).toBe("user typed this");
    });

    it("should handle multiple up/down navigation cycles", () => {
      const typedInput = "hello world";

      // Navigate up twice, then back down twice
      inputHistory.navigateUp(typedInput);
      inputHistory.navigateUp(typedInput);
      inputHistory.navigateDown(); // Go back one in history
      const result = inputHistory.navigateDown(); // Go back to original

      expect(result).toBe("hello world");
    });
  });

  describe("basic navigation functionality", () => {
    beforeEach(() => {
      inputHistory.addEntry("command1");
      inputHistory.addEntry("command2");
      inputHistory.addEntry("command3");
    });

    it("should navigate up through history in reverse order", () => {
      const result1 = inputHistory.navigateUp("current");
      expect(result1).toBe("command3"); // Most recent first

      const result2 = inputHistory.navigateUp("current");
      expect(result2).toBe("command2");

      const result3 = inputHistory.navigateUp("current");
      expect(result3).toBe("command1");
    });

    it("should handle navigation with no history", () => {
      fs.rmSync(HISTORY_FILE, { force: true });

      const emptyHistory = new InputHistory();
      const result = emptyHistory.navigateUp("test");
      expect(result).toBe(null);
    });
  });
});
