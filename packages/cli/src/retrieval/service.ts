import { ConfigHandler } from "core/config/ConfigHandler.js";
import type { Chunk } from "core/index.js";
import { CodebaseIndexer } from "core/indexing/CodebaseIndexer.js";
import { FullTextSearchCodebaseIndex } from "core/indexing/FullTextSearchCodebaseIndex.js";
import { LanceDbIndex } from "core/indexing/LanceDbIndex.js";
import { SqliteDb } from "core/indexing/refreshIndex.js";
import { LLMLogger } from "core/llm/logger.js";
import FileSystemIde from "core/util/filesystem.js";
import { GlobalContext } from "core/util/GlobalContext.js";
import { localPathToUri } from "core/util/pathToUri.js";

import { canonicalPath } from "../utils/canonicalPath.js";
import { logger } from "../utils/logger.js";
import { parseEnvNumber } from "../utils/truncateOutput.js";

/** Stat sweeps are cheap, but a tight loop has no business hammering them. */
const RECONCILE_MIN_INTERVAL_MS = 1_000;
/** How long an untouched index is trusted before the fallback refresh. */
const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60_000;
/**
 * How many reconciles may trigger a build on an unchanged staleness picture
 * before the trigger backs off.
 */
const RECONCILE_MAX_REPEATS = 3;

export interface RetrievalHit {
  filepath: string;
  startLine: number;
  endLine: number;
  content: string;
}

/** The one method a reranker needs; the configured model already implements it. */
type Reranker = {
  rerank(query: string, chunks: Chunk[]): Promise<number[]>;
};

function toRerankChunks(hits: readonly RetrievalHit[]): Chunk[] {
  return hits.map((hit, index) => ({
    content: hit.content,
    startLine: hit.startLine,
    endLine: hit.endLine,
    filepath: hit.filepath,
    digest: `${hit.filepath}:${hit.startLine}:${hit.endLine}`,
    index,
  }));
}

/**
 * Reorders the merged hits by the configured reranker's score. Retrieval must
 * survive a reranker that is down, slow, or returns the wrong number of scores:
 * the caller keeps the full-text order rather than losing every hit to a
 * secondary stage.
 */
export async function rerankHits(
  reranker: Reranker | undefined,
  query: string,
  hits: RetrievalHit[],
): Promise<RetrievalHit[]> {
  if (!reranker || hits.length <= 1) {
    return hits;
  }

  try {
    const scores = await reranker.rerank(query, toRerankChunks(hits));
    if (scores.length !== hits.length) {
      logger.debug("Reranker returned a different number of scores", {
        hits: hits.length,
        scores: scores.length,
      });
      return hits;
    }
    return hits
      .map((hit, index) => ({ hit, index, score: scores[index] }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.hit);
  } catch (error) {
    logger.debug("Rerank failed; keeping the retrieval order", error as Error);
    return hits;
  }
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
  /** When this process last saw an update() land. */
  private lastSuccessfulUpdateAt = 0;
  /** When the stat reconciliation last ran, however it decided. */
  private lastReconcileAt = 0;
  /** The staleness picture the last reconciles saw, for the backoff. */
  private lastChangeKey: string | null = null;
  private staleRun = 0;

  constructor(workspaceDir: string = process.cwd()) {
    // Core's IDE abstraction speaks file URIs, so the workspace the indexer
    // sees and the directory it tags the index with are both URI-shaped.
    this.workspaceDir = localPathToUri(canonicalPath(workspaceDir));
    // The CLI is neither of the two IDE types core knows, so it says so and
    // keeps the editor-specific defaults out of the config it loads.
    this.ide = new FileSystemIde(this.workspaceDir, "cli");
    this.configHandler = new ConfigHandler(this.ide, new LLMLogger());
    this.indexer = new CodebaseIndexer(this.configHandler, this.ide);
  }

  /** Walks the workspace and brings the index up to date with it. */
  async update(): Promise<void> {
    // Constructing the indexer kicks off a build of its own from the config it
    // loads, and `refreshCodebaseIndex` cancels whatever build is in flight
    // before starting. Whichever of the two lands second decides who survives -
    // and if the loser is the build a caller awaited, that caller goes on to
    // search an index its own cancelled build had written nothing to. Waiting
    // for the indexer's start makes this the build that lands second.
    await this.indexer.initPromise;
    await this.indexer.refreshCodebaseIndex([this.workspaceDir]);
    this.lastSuccessfulUpdateAt = Date.now();
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
   *
   * A build already in flight is joined before the tag catalog is trusted:
   * `markComplete` records a file's tag row as the first thing it does, while
   * the chunk and full-text tables are written after it, so answering from the
   * catalog alone can report "indexed" for a workspace a search still finds
   * nothing in.
   */
  async ensureIndexed(): Promise<void> {
    if (this.buildPromise) {
      await this.buildPromise;
    }

    if (await this.hasIndex()) {
      // The catalog answers "was this workspace indexed", not "does the index
      // still describe it": a save in an editor, a git pull or a checkout all
      // move the files under an index that looks complete. A stat-level
      // reconciliation catches that and refreshes in the background, so this
      // caller still answers immediately from what exists.
      this.reconcileIndexInBackground();
      return;
    }

    this.buildPromise ??= this.update().finally(() => {
      this.buildPromise = null;
    });
    await this.buildPromise;
  }

  /**
   * Decides whether the trusted index needs a refresh, and starts one through
   * the same single-flight build every other path uses. Two triggers: a file
   * whose mtime moved past the catalog's lastUpdated (or vanished from disk
   * entirely), and a fallback that refreshes once the last successful update
   * is older than the configured interval - a belt for everything a stat
   * cannot see, from clock skew to an IDE that answers no stats at all.
   */
  private reconcileIndexInBackground(): void {
    const now = Date.now();
    if (this.buildPromise) {
      // A build is already bringing the index up to date.
      return;
    }

    const intervalMs = parseEnvNumber(
      process.env.TNT_INDEX_RECONCILE_INTERVAL_MS,
      DEFAULT_RECONCILE_INTERVAL_MS,
    );
    const overdue =
      this.lastSuccessfulUpdateAt > 0 &&
      now - this.lastSuccessfulUpdateAt >= intervalMs;
    if (!overdue && now - this.lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) {
      return;
    }
    this.lastReconcileAt = now;

    void this.detectExternalChanges()
      .then((changedPaths) => {
        if (changedPaths.length === 0 && !overdue) {
          this.staleRun = 0;
          return;
        }
        // The same staleness seen over and over - a clock skew that keeps a
        // file's mtime ahead of every stamp, most often - must not turn every
        // search into a rebuild. A few attempts are allowed, then the trigger
        // backs off until the picture changes.
        const key = `${overdue ? "overdue" : "fresh"}|${changedPaths.sort().join(",")}`;
        if (key === this.lastChangeKey) {
          this.staleRun += 1;
        } else {
          this.staleRun = 0;
          this.lastChangeKey = key;
        }
        if (this.staleRun > RECONCILE_MAX_REPEATS) {
          logger.warn(
            "Codebase index reconciliation keeps seeing the same staleness; backing off",
            { changedPaths: changedPaths.length, overdue },
          );
          return;
        }
        logger.info("Codebase index is stale; refreshing in the background", {
          changedPaths: changedPaths.length,
          overdue,
        });
        this.startIndexing();
      })
      .catch((error) => {
        logger.debug("Codebase index reconciliation failed", error as Error);
      });
  }

  /**
   * The workspace paths that have moved under the index, judged at stat
   * level: every indexed path is statted and compared against the lastUpdated
   * the catalog recorded, the same comparison refreshIndex makes per file
   * when it decides what to re-chunk. No file content is read here.
   */
  private async detectExternalChanges(): Promise<string[]> {
    const branch = await this.ide.getBranch(this.workspaceDir);
    const db = await SqliteDb.get();
    const rows = (await db.all(
      `SELECT path, MAX(lastUpdated) AS lastUpdated FROM tag_catalog
       WHERE dir = ? AND branch = ? AND artifactId = ?
       GROUP BY path`,
      [this.workspaceDir, branch, FullTextSearchCodebaseIndex.artifactId],
    )) as { path: string; lastUpdated: number }[];
    if (rows.length === 0) {
      // Nothing to reconcile against - treat the whole index as stale.
      return ["*"];
    }

    const stats = await this.ide.getFileStats(rows.map((row) => row.path));
    const changed: string[] = [];
    for (const row of rows) {
      const stat = stats[row.path];
      // A path with no stat was deleted outside the process; a newer mtime
      // was modified outside it. Both are the indexer's to reconcile.
      if (!stat || stat.lastModified > row.lastUpdated) {
        changed.push(row.path);
      }
    }
    return changed;
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
    await this.indexer.refreshFile(localPathToUri(canonicalPath(filePath)), [
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
    const merged = mergeHits(ftsHits, vectorHits, n);
    return rerankHits(await this.getReranker(), query, merged);
  }

  /**
   * The config's rerank role, when one is selected. A config that never names
   * a reranker keeps the merged order and pays nothing for this stage.
   */
  private async getReranker(): Promise<Reranker | undefined> {
    try {
      const { config } = await this.configHandler.loadConfig();
      return config?.selectedModelByRole.rerank;
    } catch (error) {
      logger.debug("No reranker available", error as Error);
      return undefined;
    }
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

  /**
   * Re-reads the config from disk. Selection commands call this first: a user
   * who just edited config.yaml to add an embeddings model expects the next
   * command to see it, and the handler caches what it loaded.
   */
  async refreshConfig(): Promise<void> {
    await this.configHandler.reloadConfig("cli index command");
  }

  /** Titles of the models the config offers for the embed role. */
  async embeddingModels(): Promise<string[]> {
    const { config } = await this.configHandler.loadConfig();
    return (config?.modelsByRole.embed ?? []).map(
      (model: { title: string }) => model.title,
    );
  }

  /** The title the load currently resolves embeddings to, if any. */
  async selectedEmbeddingModel(): Promise<string | null> {
    const { config } = await this.configHandler.loadConfig();
    return config?.selectedModelByRole.embed?.title ?? null;
  }

  /**
   * Points this profile's embed role at one of the configured models and
   * drops the cached vector index, so the next search builds against the new
   * model. The choice goes into the global context, where the config load
   * picks it up - the same place the editors store model selections.
   */
  async selectEmbeddingModel(title: string): Promise<boolean> {
    if (!(await this.embeddingModels()).includes(title)) {
      return false;
    }
    const profileId = this.configHandler.currentProfile?.profileDescription.id;
    if (!profileId) {
      return false;
    }
    new GlobalContext().updateSelectedModel(profileId, "embed", title);
    this.vectorIndex = undefined;
    return true;
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
  const key = canonicalPath(workspaceDir);
  let service = services.get(key);
  if (!service) {
    service = new RetrievalService(key);
    services.set(key, service);
  }
  return service;
}
