/**
 * Online repetition detection over the assistant's own output.
 *
 * A model that is stuck often keeps emitting the same line, or the same block
 * of lines, verbatim. Waiting for the round to finish before scanning means
 * paying for a full round of tokens to discover it. Scanning the stream as it
 * arrives catches the repetition within the round that produces it.
 *
 * The test is deliberately narrow. It looks for a substring that repeats
 * consecutively, not for topical similarity, so ordinary prose that reuses a
 * phrase does not trip it. Code fences get looser thresholds because repeated
 * tokens are normal there.
 */

export interface LoopDetectorConfig {
  /** Repetitions needed on one line outside a fence. */
  singleLineMinRepetitions: number;
  /** Repetitions needed on one line inside a fence. */
  singleLineMinRepetitionsInFence: number;
  /** Repetitions needed across several lines outside a fence. */
  multiLineMinRepetitions: number;
  /** Repetitions needed across several lines inside a fence. */
  multiLineMinRepetitionsInFence: number;
  /**
   * A repeating line must be at least this long. Short lines repeat by accident
   * in ordinary output (closing braces, "ok", blank separators), so a floor
   * keeps the detector off them.
   */
  minLineLength: number;
  /**
   * Repeating length times repetitions must reach this to count. This is the
   * threshold that matters: three repetitions of a trivial string is noise,
   * while one repetition of a large block is worth noticing.
   */
  minTotalChars: number;
  /** Period times repetitions inside a fence must reach this to count. */
  minTotalCharsInFence: number;
  /**
   * Lines longer than this are ignored; they are usually dumped data such as a
   * file listing, where repetition is expected rather than a symptom.
   */
  maxLineLength: number;
}

export const DEFAULT_LOOP_DETECTOR_CONFIG: LoopDetectorConfig = {
  singleLineMinRepetitions: 3,
  singleLineMinRepetitionsInFence: 4,
  multiLineMinRepetitions: 2,
  multiLineMinRepetitionsInFence: 3,
  minLineLength: 20,
  minTotalChars: 100,
  minTotalCharsInFence: 200,
  maxLineLength: 10_000,
};

export type LoopKind =
  | "single_message_single_line"
  | "single_message_multi_line";

export interface LoopDetection {
  kind: LoopKind;
  /** The repeated unit, truncated for logging. */
  pattern: string;
  /** Number of consecutive times the unit appeared. */
  repetitions: number;
  /**
   * Stable identity for this loop, so two detections of the same repetition
   * can be recognized as one incident rather than two.
   */
  fingerprint: string;
}

const FENCE_MARKERS = ["```", "~~~"];
const LOG_PATTERN_LIMIT = 200;

/**
 * Small non-cryptographic hash. The fingerprint only has to be stable within a
 * session, not collision resistant, so this stays cheap enough to run on every
 * chunk.
 */
function fingerprintLoop(kind: LoopKind, pattern: string): string {
  let hash = 5381;
  const input = `${kind}:${pattern}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function truncateForLog(pattern: string): string {
  return pattern.length > LOG_PATTERN_LIMIT
    ? `${pattern.slice(0, LOG_PATTERN_LIMIT)}...`
    : pattern;
}

/**
 * Tracks one assistant message's worth of streamed text.
 *
 * Feed text with `feed` as it arrives, then call `finish` once the message
 * completes. A detection, if any, is returned by `finish`. The detector holds
 * state for the current message only; the caller starts a new one per round so
 * a repetition spanning two messages is not confused with one inside a
 * message.
 */
export class LoopDetector {
  private readonly config: LoopDetectorConfig;
  private text = "";
  private lastDetection: LoopDetection | undefined;

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_LOOP_DETECTOR_CONFIG, ...config };
  }

  /** Append streamed text and return a detection as soon as one appears. */
  feed(chunk: string): LoopDetection | undefined {
    if (!chunk) {
      return undefined;
    }
    this.text += chunk;
    return this.detect();
  }

  /**
   * Return a detection for the completed message, if the accumulated text
   * contains a repeating unit that crossed a threshold.
   */
  finish(): LoopDetection | undefined {
    return this.detect();
  }

  /** True when any threshold was crossed at any point during the message. */
  get detected(): LoopDetection | undefined {
    return this.lastDetection;
  }

  private detect(): LoopDetection | undefined {
    if (this.lastDetection) {
      return this.lastDetection;
    }

    // Blocks first: they require more repetitions, so when both match, the
    // block is the stronger evidence and the more specific report.
    const byBlock = this.detectRepeatingBlock();
    if (byBlock) {
      this.lastDetection = byBlock;
      return byBlock;
    }

    const byLine = this.detectRepeatingLine();
    if (byLine) {
      this.lastDetection = byLine;
      return byLine;
    }

    return undefined;
  }

  /**
   * Find a run of identical consecutive lines. Consecutive is the operative
   * word: a line that appears twice in different places is normal prose.
   */
  private detectRepeatingLine(): LoopDetection | undefined {
    const lines = this.text.split("\n");
    let fence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      fence = this.updateFence(fence, lines[i]!);

      if (line.length === 0 || line.length > this.config.maxLineLength) {
        continue;
      }

      const repeatsNeeded = fence
        ? this.config.singleLineMinRepetitionsInFence
        : this.config.singleLineMinRepetitions;

      // Look ahead for a run of identical lines starting here. The run ends at
      // the first line that differs, so the count is exact rather than
      // depending on how the text happens to be split into chunks.
      let repetitions = 1;
      while (
        i + repetitions < lines.length &&
        lines[i + repetitions]!.trim() === line
      ) {
        repetitions++;
      }

      if (
        repetitions >= repeatsNeeded &&
        line.length >= this.config.minLineLength &&
        repetitions * line.length >= this.totalCharsThreshold(fence)
      ) {
        return {
          kind: "single_message_single_line",
          pattern: truncateForLog(line),
          repetitions,
          fingerprint: fingerprintLoop("single_message_single_line", line),
        };
      }

      // Skip past the run so the same repetition is not re-examined from every
      // line inside it.
      i += repetitions - 1;
    }

    return undefined;
  }

  /**
   * Find a run of identical consecutive line groups. This catches a model
   * repeating a multi-line block, such as re-emitting the same shell script or
   * the same file content on every attempt.
   */
  private detectRepeatingBlock(): LoopDetection | undefined {
    const lines = this.text.split("\n");
    if (lines.length < 4) {
      return undefined;
    }

    // Block repetition is scored once against the whole message. Toggling the
    // fence per block would let a block that sits entirely inside a fence be
    // judged by the looser threshold, which is the intent.
    const fence = this.text.includes(FENCE_MARKERS[0]!);
    const repeatsNeeded = fence
      ? this.config.multiLineMinRepetitionsInFence
      : this.config.multiLineMinRepetitions;
    const totalThreshold = this.totalCharsThreshold(fence);

    for (let period = 2; period <= 8; period++) {
      if (lines.length < period * repeatsNeeded) {
        continue;
      }

      let cursor = 0;
      while (cursor + period * repeatsNeeded <= lines.length) {
        const unit = lines.slice(cursor, cursor + period).join("\n");

        if (unit.trim().length > 0) {
          let identical = true;
          for (let rep = 1; rep < repeatsNeeded; rep++) {
            const candidate = lines
              .slice(cursor + rep * period, cursor + (rep + 1) * period)
              .join("\n");
            if (candidate !== unit) {
              identical = false;
              break;
            }
          }

          if (identical && unit.length * repeatsNeeded >= totalThreshold) {
            return {
              kind: "single_message_multi_line",
              pattern: truncateForLog(unit),
              repetitions: repeatsNeeded,
              fingerprint: fingerprintLoop("single_message_multi_line", unit),
            };
          }
        }

        cursor += 1;
      }
    }

    return undefined;
  }

  private totalCharsThreshold(inFence: boolean): number {
    return inFence
      ? this.config.minTotalCharsInFence
      : this.config.minTotalChars;
  }

  private updateFence(open: boolean, line: string): boolean {
    if (!FENCE_MARKERS.some((marker) => line.includes(marker))) {
      return open;
    }
    return !open;
  }
}
