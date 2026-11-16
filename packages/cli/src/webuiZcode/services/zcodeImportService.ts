import { IZCodeTaskService } from "@zcode/services";
import type {
  ZCodeImportSessionsResult,
  ZCodeImportableSessionCandidate,
} from "@zcode/shared";

import {
  importCandidates,
  scanImportCandidates,
  type ImportScanOptions,
} from "./importSources.js";
import { stubServiceWith } from "./stubs.js";

/** Options the TNT host may inject for tests or a custom state root. */
export interface ZcodeImportServiceOptions extends ImportScanOptions {}

/**
 * The settings page's migration section only needs these two methods. The
 * remaining task-service channels stay as stubs so an unrelated call fails
 * with ZCODE_UNAVAILABLE instead of pretending to work.
 */
export function createZcodeImportService(
  options: ZcodeImportServiceOptions = {},
): IZCodeTaskService {
  const overrides: Partial<IZCodeTaskService> = {
    async scanImportableClaudeSessions(params: {
      workspacePath?: string;
      workspaceIdentity?: string;
      modifiedSince?: number;
      limit?: number;
    }): Promise<ZCodeImportableSessionCandidate[]> {
      return scanImportCandidates({
        ...options,
        workspacePath: params.workspacePath ?? options.workspacePath,
        modifiedSince: params.modifiedSince ?? options.modifiedSince,
        limit: params.limit ?? options.limit,
      }).map((candidate) => ({
        provider: candidate.provider,
        sessionId: candidate.sessionId,
        workspacePath: candidate.workspacePath,
        sourcePath: candidate.sourcePath,
        updatedAt: candidate.updatedAt,
        ...(candidate.createdAt === undefined
          ? {}
          : { createdAt: candidate.createdAt }),
        ...(candidate.previewTitle === undefined
          ? {}
          : { previewTitle: candidate.previewTitle }),
      }));
    },
    async importClaudeSessions(params: {
      workspacePath?: string;
      workspaceIdentity?: string;
      sessionIds: string[];
    }): Promise<ZCodeImportSessionsResult> {
      const result = importCandidates(params.sessionIds, {
        ...options,
        workspacePath: params.workspacePath ?? options.workspacePath,
      });
      return {
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      };
    },
  };
  return stubServiceWith<IZCodeTaskService>(
    IZCodeTaskService.channelName,
    overrides,
  );
}
