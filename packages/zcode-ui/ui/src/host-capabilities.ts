/**
 * What the host serving this shell can actually do.
 *
 * The ZCode UI was built for the ZCode desktop app: it offers account login,
 * coding-plan purchases, and settings that only exist when the app runs on the
 * same machine as the files. TNT's host has its own config, its own model
 * files and no ZCode account, so a surface that keeps the desktop assumptions
 * shows login prompts and purchase buttons for things that cannot work.
 *
 * The bootstrap sets these once, before the first render. Components read the
 * snapshot at render time; they do not subscribe, because the host's
 * capabilities do not change while the page is open.
 */
export interface HostCapabilities {
  /** ZCode account login and coding-plan subscription UI. */
  codingPlan: boolean;
  /** Offer only providers backed by the local config, never account presets. */
  localProvidersOnly: boolean;
  /** The shell may edit files on the machine that hosts the services. */
  localFileSettings: boolean;
}

const DEFAULT_CAPABILITIES: HostCapabilities = {
  codingPlan: true,
  localProvidersOnly: false,
  localFileSettings: false,
};

let current: HostCapabilities = { ...DEFAULT_CAPABILITIES };

export function setHostCapabilities(
  patch: Partial<HostCapabilities>,
): HostCapabilities {
  current = { ...current, ...patch };
  return current;
}

export function getHostCapabilities(): HostCapabilities {
  return current;
}

export function resetHostCapabilitiesForTests(): void {
  current = { ...DEFAULT_CAPABILITIES };
}
