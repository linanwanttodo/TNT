import path from "path";
import { fileURLToPath } from "url";

import workerpool from "workerpool";

export interface AsyncEncoder {
  encode(text: string): Promise<number[]>;
  decode(tokens: number[]): Promise<string>;
  close(): Promise<void>;
}

export class LlamaAsyncEncoder implements AsyncEncoder {
  private workerPool: workerpool.Pool;

  constructor() {
    this.workerPool = workerpool.pool(
      workerCodeFilePath("llamaTokenizerWorkerPool.mjs"),
    );
  }

  async encode(text: string): Promise<number[]> {
    return this.workerPool.exec("encode", [text]);
  }

  async decode(tokens: number[]): Promise<string> {
    return this.workerPool.exec("decode", [tokens]);
  }

  // TODO: this should be called somewhere before exit or potentially with a shutdown hook
  public async close(): Promise<void> {
    await this.workerPool.terminate();
  }
}

// this class does not yet do anything asynchronous
export class GPTAsyncEncoder implements AsyncEncoder {
  private workerPool: workerpool.Pool;

  constructor() {
    this.workerPool = workerpool.pool(
      workerCodeFilePath("tiktokenWorkerPool.mjs"),
    );
  }

  async encode(text: string): Promise<number[]> {
    return this.workerPool.exec("encode", [text]);
  }

  async decode(tokens: number[]): Promise<string> {
    return this.workerPool.exec("decode", [tokens]);
  }

  // TODO: this should be called somewhere before exit or potentially with a shutdown hook
  public async close(): Promise<void> {
    await this.workerPool.terminate();
  }
}

function workerCodeFilePath(workerFileName: string): string {
  // The worker file sits beside this module, so its own URL is the one location
  // that is right in the npm build (ESM, where __dirname does not exist), in the
  // CLI bundle (also ESM) and in the test runners. __dirname is kept only for
  // consumers that load this package as CommonJS.
  const here =
    typeof import.meta.url === "string"
      ? path.dirname(fileURLToPath(import.meta.url))
      : __dirname;
  return path.join(here, workerFileName);
}
