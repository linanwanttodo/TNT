import type { Readable, Writable } from "node:stream";

export const MAX_LINE_BYTES = 16 * 1024 * 1024;

const NEWLINE = 0x0a;

export interface NdjsonTransportCallbacks {
  onMessage(message: unknown): void;
  onLineError(error: Error): void;
  onEnd(): void;
}

export interface NdjsonTransportOptions {
  input: Readable;
  output: Writable;
  maxLineBytes?: number;
}

export class NdjsonTransport {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly maxLineBytes: number;
  private readonly segments: Buffer[] = [];
  private lineBytes = 0;
  private discardingLine = false;
  private started = false;
  private stopped = false;
  private callbacks: NdjsonTransportCallbacks | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: NdjsonTransportOptions) {
    this.input = options.input;
    this.output = options.output;
    this.maxLineBytes = options.maxLineBytes ?? MAX_LINE_BYTES;
  }

  start(callbacks: NdjsonTransportCallbacks): void {
    if (this.started) {
      throw new Error("NDJSON transport already started");
    }
    this.started = true;
    this.callbacks = callbacks;
    this.input.on("data", this.handleData);
    this.input.on("end", this.handleEnd);
    this.input.on("error", this.handleInputError);
    this.input.resume();
    if (this.input.readableEnded) {
      queueMicrotask(() => this.finishInput());
    }
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.input.off("data", this.handleData);
    this.input.off("end", this.handleEnd);
    this.input.off("error", this.handleInputError);
    this.callbacks = null;
  }

  /**
   * Serialize writes so concurrent handlers cannot interleave, and resolve the
   * returned promise only once the bytes have left the stream (after `drain`
   * when `write()` reports backpressure). Sends already accepted by shutdown
   * still reach stdout: `stop()` only detaches the input side.
   */
  send(message: unknown): Promise<void> {
    const line = `${JSON.stringify(message)}\n`;
    const write = this.writeChain.then(() => this.writeLine(line));
    this.writeChain = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  flush(): Promise<void> {
    return this.writeChain;
  }

  private writeLine(line: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const accepted = this.output.write(line, (error?: Error | null) => {
        finish(error);
      });
      if (!accepted) {
        this.output.once("drain", () => finish(null));
      }
    });
  }

  private readonly handleData = (chunk: Buffer): void => {
    let offset = 0;
    while (offset <= chunk.length) {
      const newline = chunk.indexOf(NEWLINE, offset);
      const end = newline === -1 ? chunk.length : newline;
      this.append(chunk.subarray(offset, end));
      if (newline === -1) {
        return;
      }
      this.completeLine();
      offset = newline + 1;
    }
  };

  private readonly handleEnd = (): void => {
    this.completeTrailingLine();
    this.finishInput();
  };

  private readonly handleInputError = (error: Error): void => {
    this.callbacks?.onLineError(error);
    this.finishInput();
  };

  private finishInput(): void {
    const callbacks = this.callbacks;
    if (!callbacks) {
      return;
    }
    this.callbacks = null;
    callbacks.onEnd();
  }

  private append(segment: Buffer): void {
    if (segment.length === 0 || this.discardingLine) {
      return;
    }
    if (this.lineBytes + segment.length > this.maxLineBytes) {
      this.segments.length = 0;
      this.lineBytes = 0;
      this.discardingLine = true;
      this.callbacks?.onLineError(
        new Error(`NDJSON line exceeds ${this.maxLineBytes} bytes`),
      );
      return;
    }
    this.segments.push(Buffer.from(segment));
    this.lineBytes += segment.length;
  }

  private completeLine(): void {
    if (this.discardingLine) {
      this.discardingLine = false;
      return;
    }
    this.deliver(Buffer.concat(this.segments).toString("utf8"));
    this.segments.length = 0;
    this.lineBytes = 0;
  }

  private completeTrailingLine(): void {
    if (this.discardingLine) {
      this.discardingLine = false;
      return;
    }
    if (this.lineBytes > 0) {
      this.deliver(Buffer.concat(this.segments).toString("utf8"));
    }
    this.segments.length = 0;
    this.lineBytes = 0;
  }

  private deliver(raw: string): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim().length === 0) {
      return;
    }
    try {
      this.callbacks?.onMessage(JSON.parse(line));
    } catch (error) {
      this.callbacks?.onLineError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
