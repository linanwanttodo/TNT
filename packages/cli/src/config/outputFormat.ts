/**
 * The values `--format` accepts for headless output. `stream-json` emits one
 * JSON object per line as the run progresses; `json` prints a single JSON
 * document when the turn is done.
 */
export const OUTPUT_FORMATS = ["json", "stream-json"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}
