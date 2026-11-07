#!/usr/bin/env node

/**
 * Analyzes git commit history to find file hotspots (most commonly edited files)
 * Usage: node analyze-file-hotspots.js [days] [limit]
 * Example: node analyze-file-hotspots.js 30 20
 */

const { execFileSync } = require("child_process");

// Parse command line arguments
const args = process.argv.slice(2);
const days = parseInt(args[0]) || 30;
const limit = parseInt(args[1]) || 20;

try {
  // Calculate the date from N days ago
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const sinceDateStr = sinceDate.toISOString().split("T")[0];

  // Get the git log with file change stats. Array form without a shell: the
  // arguments are data, so nothing here can be re-parsed as command syntax.
  const output = execFileSync(
    "git",
    ["log", `--since=${sinceDateStr}`, "--name-only", "--pretty=format:"],
    {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    },
  );

  // Parse the output and count file occurrences
  const fileCount = {};
  const lines = output.split("\n").filter((line) => line.trim() !== "");

  lines.forEach((line) => {
    const file = line.trim();
    if (file) {
      fileCount[file] = (fileCount[file] || 0) + 1;
    }
  });

  // Sort files by edit count (descending)
  const sortedFiles = Object.entries(fileCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  // Display results as tab-separated values
  sortedFiles.forEach(([file, count]) => {
    console.log(`${count}\t${file}`);
  });
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
