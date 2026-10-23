export interface TerminalRunOptions {
  shell: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface TerminalRunResult {
  output: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut: boolean;
  /** Set when the client terminal kept running instead of being killed. */
  backgroundJobId?: string;
}

export interface TerminalRunner {
  run(
    options: TerminalRunOptions,
    signal?: AbortSignal,
  ): Promise<TerminalRunResult>;
  /** Release client-owned terminals that outlived their command. */
  dispose?(): Promise<void>;
}

let active: TerminalRunner | null = null;

export function setTerminalRunner(runner: TerminalRunner | null): void {
  active = runner;
}

export function getTerminalRunner(): TerminalRunner | null {
  return active;
}
