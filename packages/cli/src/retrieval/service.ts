import path from "path";

import { ConfigHandler } from "core/config/ConfigHandler.js";
import { CodebaseIndexer } from "core/indexing/CodebaseIndexer.js";
import { FullTextSearchCodebaseIndex } from "core/indexing/FullTextSearchCodebaseIndex.js";
import { LLMLogger } from "core/llm/logger.js";
import FileSystemIde from "core/util/filesystem.js";
import { localPathToUri } from "core/util/pathToUri.js";

import { logger } from "../utils/logger.js";

export interface RetrievalHit {
  filepath: string;
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Hosts core's codebase indexer for the CLI.
 *
 * The index is built into the shared index database under the global
 * directory, keyed by directory and branch, and read back by full-text
 * search: `update()` walks the workspace, `search()` asks the same index the
 * IDE extensions query. The indexer builds its indexes from the config file,
 * so a config with a codebase context provider and no embeddings model ends
 * up with full-text search over file chunks, which needs no provider.
 */
export class RetrievalService {
  private readonly workspaceDir: string;
  private readonly ide: FileSystemIde;
  private readonly indexer: CodebaseIndexer;

  constructor(workspaceDir: string = process.cwd()) {
    // Core's IDE abstraction speaks file URIs, so the workspace the indexer
    // sees and the directory it tags the index with are both URI-shaped.
    this.workspaceDir = localPathToUri(path.resolve(workspaceDir));
    // The CLI is neither of the two IDE types core knows, so it says so and
    // keeps the editor-specific defaults out of the config it loads.
    this.ide = new FileSystemIde(this.workspaceDir, "cli");
    this.indexer = new CodebaseIndexer(
      new ConfigHandler(this.ide, new LLMLogger()),
      this.ide,
    );
  }

  /** Walks the workspace and brings the index up to date with it. */
  async update(): Promise<void> {
    await this.indexer.refreshCodebaseIndex([this.workspaceDir]);
  }

  /** Full-text search over the indexed chunks, best match first. */
  async search(text: string, n: number = 10): Promise<RetrievalHit[]> {
    const query = text.trim();
    if (!query) {
      return [];
    }
    const branch = await this.ide.getBranch(this.workspaceDir);
    try {
      const chunks = await new FullTextSearchCodebaseIndex().retrieve({
        tags: [{ directory: this.workspaceDir, branch }],
        text: query,
        n,
        // The shared default (-2.5) assumes a large corpus: bm25 scores stay
        // near zero while a workspace is small, and a threshold tuned for
        // thousands of chunks would drop every match here. The n limit is
        // what keeps the result short instead.
        bm25Threshold: 0,
      });
      return chunks.map((chunk) => ({
        filepath: chunk.filepath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
      }));
    } catch (error) {
      // A query before the first update finds no index tables; the caller
      // gets an empty result and the reason is in the log.
      logger.debug("Codebase search failed", error as Error);
      return [];
    }
  }
}
