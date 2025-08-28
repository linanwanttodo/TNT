import path from "path";

import { ConfigHandler } from "core/config/ConfigHandler.js";
import { CodebaseIndexer } from "core/indexing/CodebaseIndexer.js";
import { FullTextSearchCodebaseIndex } from "core/indexing/FullTextSearchCodebaseIndex.js";
import { LanceDbIndex } from "core/indexing/LanceDbIndex.js";
import { SqliteDb } from "core/indexing/refreshIndex.js";
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

/** Keeps the primary order, drops duplicates, and caps the combined list. */
export function mergeHits(
  primary: RetrievalHit[],
  secondary: RetrievalHit[],
  n: number,
): RetrievalHit[] {
  const seen = new Set(
    primary.map((hit) => `${hit.filepath}:${hit.startLine}:${hit.endLine}`),
  );
  const merged = [...primary];
  for (const hit of secondary) {
    const key = `${hit.filepath}:${hit.startLine}:${hit.endLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(hit);
    if (merged.length >= n) {
      break;
    }
  }
  return merged.slice(0, n);
}

/**
 * Hosts core's codebase indexer for the CLI.
 *
 * The index is built into the shared index database under the global
 * directory, keyed by directory and branch, and read back by full-text
 * search: `update()` walks the workspace, `search()` asks the same index the
 * IDE extensions query. The indexer builds its indexes from the config file,
 * so a config with a codebase context provider and no embeddings model ends
 * up with full-text search over file chunks, which needs no provider. With
 * an embeddings model selected, search also asks the vector index and merges
 * its hits behind the full-text ones.
 */
export class RetrievalService {
  private readonly workspaceDir: string;
  private readonly ide: FileSystemIde;
  private readonly configHandler: ConfigHandler;
  private readonly indexer: CodebaseIndexer;
  private buildPromise: Promise<void> | null = null;
  /** undefined until a search asks; null when the config selects no model. */
  private vectorIndex: LanceDbIndex | null | undefined = undefined;

  constructor(workspaceDir: string = process.cwd()) {
    // Core's IDE abstraction speaks file URIs, so the workspace the indexer
    // sees and the directory it tags the index with are both URI-shaped.
    this.workspaceDir = localPathToUri(path.resolve(workspaceDir));
    // The CLI is neither of the two IDE types core knows, so it says so and
    // keeps the editor-specific defaults out of the config it loads.
    this.ide = new FileSystemIde(this.workspaceDir, "cli");
    this.configHandler = new ConfigHandler(this.ide, new LLMLogger());
    this.indexer = new CodebaseIndexer(this.configHandler, this.ide);
  }

  /** Walks the workspace and brings the index up to date with it. */
  async update(): Promise<void> {
    await this.indexer.refreshCodebaseIndex([this.workspaceDir]);
  }

  /** Whether this directory already has a full-text index to answer from. */
  async hasIndex(): Promise<boolean> {
    const branch = await this.ide.getBranch(this.workspaceDir);
    try {
      const db = await SqliteDb.get();
      const rows = await db.all(
        "SELECT 1 FROM tag_catalog WHERE artifactId = ? AND dir = ? AND branch = ? LIMIT 1",
        [FullTextSearchCodebaseIndex.artifactId, this.workspaceDir, branch],
      );
      return rows.length > 0;
    } catch (error) {
      // A database that has never been written has no tag table yet.
      logger.debug("Codebase index lookup failed", error as Error);
      return false;
    }
  }

  /**
   * Builds the index on first use and reuses it afterwards. Two callers that
   * race on an unbuilt workspace share one build.
   */
  async ensureIndexed(): Promise<void> {
    if (await this.hasIndex()) {
      return;
    }
    this.buildPromise ??= this.update().finally(() => {
      this.buildPromise = null;
    });
    await this.buildPromise;
  }

  /**
   * Builds the index in the background; a build already running is joined
   * rather than doubled. The caller polls `indexingProgress()` - and, when it
   * wants certainty, `hasIndex()` - instead of waiting on a frozen command.
   */
  startIndexing(): void {
    this.buildPromise ??= this.update().finally(() => {
      this.buildPromise = null;
    });
  }

  isIndexing(): boolean {
    return this.buildPromise !== null;
  }

  /** The indexer's own progress, live while a build runs. */
  indexingProgress(): { status: string; desc: string; progress: number } {
    const state = this.indexer.currentIndexingState;
    return {
      status: state.status,
      desc: state.desc,
      progress: state.progress,
    };
  }

  /**
   * Re-indexes one file, for the tools that just wrote it. Files outside the
   * workspace are ignored by the indexer.
   */
  async refreshFile(filePath: string): Promise<void> {
    await this.indexer.refreshFile(localPathToUri(path.resolve(filePath)), [
      this.workspaceDir,
    ]);
  }

  /** Full-text search over the indexed chunks, best match first. */
  async search(text: string, n: number = 10): Promise<RetrievalHit[]> {
    const query = text.trim();
    if (!query) {
      return [];
    }
    const ftsHits = await this.fullTextSearch(query, n);
    const vectorHits = await this.vectorSearch(query, n);
    return mergeHits(ftsHits, vectorHits, n);
  }

  private async fullTextSearch(
    query: string,
    n: number,
  ): Promise<RetrievalHit[]> {
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
      return toHits(chunks);
    } catch (error) {
      // A query before the first update finds no index tables; the caller
      // gets an empty result and the reason is in the log.
      logger.debug("Codebase search failed", error as Error);
      return [];
    }
  }

  /** The vector half, for configs that select an embeddings model. */
  private async vectorSearch(
    query: string,
    n: number,
  ): Promise<RetrievalHit[]> {
    const index = await this.getVectorIndex();
    if (!index) {
      return [];
    }
    const branch = await this.ide.getBranch(this.workspaceDir);
    try {
      const chunks = await index.retrieve(
        query,
        n,
        [{ directory: this.workspaceDir, branch }],
        undefined,
      );
      return toHits(chunks);
    } catch (error) {
      logger.debug("Vector search failed", error as Error);
      return [];
    }
  }

  /** Whether the config selects an embeddings model for the vector index. */
  async hasEmbeddingsModel(): Promise<boolean> {
    return (await this.getVectorIndex()) !== null;
  }

  private async getVectorIndex(): Promise<LanceDbIndex | null> {
    if (this.vectorIndex !== undefined) {
      return this.vectorIndex;
    }
    try {
      const { config } = await this.configHandler.loadConfig();
      const embedModel = config?.selectedModelByRole.embed;
      this.vectorIndex = embedModel
        ? await LanceDbIndex.create(embedModel, (filepath) =>
            this.ide.readFile(filepath),
          )
        : null;
    } catch (error) {
      // No model, or a platform the vector engine does not support: search
      // keeps working on the full-text index alone.
      logger.debug("Vector index unavailable", error as Error);
      this.vectorIndex = null;
    }
    return this.vectorIndex;
  }
}

function toHits(
  chunks: {
    filepath: string;
    startLine: number;
    endLine: number;
    content: string;
  }[],
): RetrievalHit[] {
  return chunks.map((chunk) => ({
    filepath: chunk.filepath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
  }));
}

const services = new Map<string, RetrievalService>();

/** One index host per workspace for the life of the process. */
export function getRetrievalService(
  workspaceDir: string = process.cwd(),
): RetrievalService {
  const key = path.resolve(workspaceDir);
  let service = services.get(key);
  if (!service) {
    service = new RetrievalService(key);
    services.set(key, service);
  }
  return service;
}
