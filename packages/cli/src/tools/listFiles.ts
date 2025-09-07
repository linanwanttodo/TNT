import * as fs from "fs";
import * as path from "path";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

import { formatToolArgument } from "./formatters.js";
import { Tool } from "./types.js";

// List files in a directory
export const listFilesTool: Tool = {
  name: "List",
  displayName: "List",
  description: "List files in a directory",
  parameters: {
    type: "object",
    properties: {
      dirpath: {
        type: "string",
        description:
          "The path to the directory to list. Defaults to the current working directory",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    // A call with no path lists the project the run is already in, which is what
    // the preview below always said it would do - before, the missing path
    // reached path.normalize and surfaced as a TypeError.
    const requested = typeof args?.dirpath === "string" ? args.dirpath : "";
    const dirPath = path.resolve(
      process.cwd(),
      path.normalize(requested || "."),
    );

    if (!fs.existsSync(dirPath)) {
      throw new ContinueError(
        ContinueErrorReason.DirectoryNotFound,
        `Directory does not exist: ${dirPath}`,
      );
    }

    if (!fs.statSync(dirPath).isDirectory()) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `Error: Path is not a directory: ${dirPath}`,
      );
    }

    return {
      args: {
        dirpath: dirPath,
      },
      preview: [
        {
          type: "text",
          content: `Will list files in: ${formatToolArgument(dirPath)}`,
        },
      ],
    };
  },
  run: async (args: { dirpath: string }): Promise<string> => {
    try {
      const files = fs.readdirSync(args.dirpath);
      const fileDetails = files.map((file) => {
        const fullPath = path.join(args.dirpath, file);
        const stats = fs.statSync(fullPath);
        const type = stats.isDirectory() ? "directory" : "file";
        const size = stats.isFile() ? `${stats.size} bytes` : "";
        return `${file} (${type}${size ? `, ${size}` : ""})`;
      });

      return `Files in ${args.dirpath}:\n${fileDetails.join("\n")}`;
    } catch (error) {
      throw new Error(
        `Error listing files: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
