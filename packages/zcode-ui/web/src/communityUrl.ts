import {
  resolveHelpAppConfig,
  type Locale,
} from "@zcode/shared";
import localDefaultAppConfig from "../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  localConfig?: unknown;
}

/**
 * The help links come from the local config only. TNT is a local-first tool:
 * asking a remote service for the community and feedback links put a request
 * to the vendor's cloud on every page load, which failed as a cross-origin
 * error and told the user nothing the local config did not already say.
 */
export async function resolveWebHelpConfig(options: ResolveWebCommunityUrlOptions = {}) {
  return resolveHelpAppConfig(
    undefined,
    options.localConfig ?? localDefaultAppConfig,
  );
}

export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  return (await resolveWebHelpConfig(options)).community_urls?.[locale];
}
