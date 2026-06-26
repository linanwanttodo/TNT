/**
 * The glyphs the interface draws, per terminal flavour.
 *
 * They were literals in a dozen components, so a terminal without the right font
 * showed boxes with no way to ask for ASCII - and the same mark drifted between
 * files. Three presets are the whole surface: `unicode` is what a modern terminal
 * shows, `ascii` is for fonts and terminals that show nothing else, and `nerd`
 * uses Nerd Font codepoints for people who install one.
 *
 * `TNT_SYMBOLS` picks one; anything unrecognised keeps `unicode`, because a typo
 * should not turn the interface into ASCII by surprise.
 */
export interface Symbols {
  /** The row marker in a selectable list. */
  selected: string;
  /** A filled mark, e.g. a status dot. */
  bullet: string;
  /** An open ring, e.g. an unfinished item. */
  ring: string;
  /** A finished item. */
  check: string;
  /** Shown while a turn is thinking. */
  thinking: string;
  /** Spinner frames, in the order they cycle. */
  spinner: readonly string[];
}

const UNICODE: Symbols = {
  selected: "\u276F",
  bullet: "\u25CF",
  ring: "\u25CB",
  check: "\u2713",
  thinking: "\u25D0",
  spinner: [
    "\u280B",
    "\u2819",
    "\u2839",
    "\u2838",
    "\u283C",
    "\u2834",
    "\u2826",
    "\u2827",
    "\u2807",
    "\u280F",
  ],
};

const ASCII: Symbols = {
  selected: ">",
  bullet: "*",
  ring: "o",
  check: "v",
  thinking: "~",
  spinner: ["|", "/", "-", "\\"],
};

/**
 * Nerd Font codepoints: chevron-right, circle, circle-o, and a half-filled
 * circle. The spinner stays braille, which every Nerd Font patches.
 */
const NERD: Symbols = {
  selected: "\uF054",
  bullet: "\uF111",
  ring: "\uF10C",
  check: "\uF00C",
  thinking: "\uF042",
  spinner: UNICODE.spinner,
};

export type SymbolPreset = keyof typeof PRESETS;

export const PRESETS = {
  unicode: UNICODE,
  ascii: ASCII,
  nerd: NERD,
} as const;

export function symbolsFor(preset?: string): Symbols {
  const key = (preset ?? "").toLowerCase().trim() as SymbolPreset;
  return PRESETS[key] ?? UNICODE;
}

export function symbols(): Symbols {
  return symbolsFor(process.env.TNT_SYMBOLS);
}

/**
 * The marks Claude Code's transcript is built from. They are separate tokens
 * rather than aliases of `Symbols` because their meanings are narrower: the
 * filled dot marks one tool call, the gutter hangs its result beneath it, and
 * the title glyphs live in the terminal title, not in the frame.
 */
export interface ClaudeGlyphs {
  /** The tool-call and assistant dot: U+23FA on macOS, U+25CF elsewhere. */
  filledDot: string;
  /** The gutter that places a tool result under its call. */
  resultGutter: string;
  /** The pointer before the input. */
  promptPointer: string;
  /** The static prefix of the terminal title. */
  titlePrefix: string;
  /** The two frames the terminal title alternates while a turn runs. */
  titleFrames: readonly [string, string];
}

/** The filled dot for a platform; injected so render code stays testable. */
export function claudeFilledDot(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "darwin" ? "\u23FA" : "\u25CF";
}

/**
 * Resolves the Claude glyphs. `platform` is a parameter rather than a read
 * inside a component so a test can pin both dot variants without owning the
 * machine it runs on.
 */
export function claudeGlyphs(
  platform: NodeJS.Platform = process.platform,
): ClaudeGlyphs {
  return {
    filledDot: claudeFilledDot(platform),
    resultGutter: "\u23BF",
    promptPointer: "\u276F",
    titlePrefix: "\u2733",
    titleFrames: ["\u2802", "\u2810"],
  };
}
