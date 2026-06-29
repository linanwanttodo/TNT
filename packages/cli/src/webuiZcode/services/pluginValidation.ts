import * as fs from "node:fs";

import type { ZCodePluginsValidateResult } from "@zcode/shared";

import { catalogEntry } from "./pluginCatalog.js";
import { diagnostic } from "./pluginMapping.js";
import {
  isInstallableSource,
  parseSourceOrUnavailable,
} from "./pluginSources.js";

export function validateTarget(
  params: {
    source?: string;
    marketplace?: string;
    pluginName?: string;
  },
  channelName: string,
): ZCodePluginsValidateResult {
  const empty = { runnable: [], diagnosticOnly: [], unsupported: [] };
  if (params.source) {
    return validateSource(params.source, channelName);
  }
  if (!params.marketplace || !params.pluginName) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "validation_target_missing",
          "Provide a source or both marketplace and pluginName",
        ),
      ],
      compatibility: empty,
    };
  }
  try {
    const entry = catalogEntry(params.marketplace, params.pluginName);
    const id = `${params.pluginName}@${params.marketplace}`;
    if (!isInstallableSource(entry.source)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "plugin_source_unsupported",
            `Plugin ${id} uses a source TNT cannot install`,
          ),
        ],
        compatibility: {
          runnable: [],
          diagnosticOnly: [],
          unsupported: [id],
        },
      };
    }
    return {
      ok: true,
      diagnostics: [],
      compatibility: {
        runnable: [id],
        diagnosticOnly: [],
        unsupported: [],
      },
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnostic("validation_failed", (error as Error).message)],
      compatibility: empty,
    };
  }
}

function validateSource(
  rawSource: string,
  channelName: string,
): ZCodePluginsValidateResult {
  const empty = { runnable: [], diagnosticOnly: [], unsupported: [] };
  const source = parseSourceOrUnavailable(rawSource, channelName);
  if (source.source === "file" || source.source === "directory") {
    const exists = fs.existsSync(source.path);
    return {
      ok: exists,
      diagnostics: exists
        ? []
        : [
            diagnostic(
              "source_missing",
              `Marketplace source ${source.path} does not exist`,
            ),
          ],
      compatibility: {
        runnable: exists ? [rawSource] : [],
        diagnosticOnly: [],
        unsupported: [],
      },
    };
  }
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        "validation_unavailable",
        "Remote marketplace sources are validated when the marketplace is added",
        "warning",
      ),
    ],
    compatibility: empty,
  };
}
