import fs from "fs";
import os from "os";
import path from "path";

import {
  ChannelClient,
  Emitter,
  SocketProtocol,
  VSBuffer,
  type ISocket,
} from "@zcode/rpc";
import {
  IModelSelectionService,
  type ModelSelectionView,
} from "@zcode/services";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";

import { writeMinimalConfig } from "../../test-utils/minimalConfig.js";

import type { WebUiService as WebUiServiceType } from "./WebUiService.js";

/**
 * The model picker wire path end to end: a real WebUiService, a real /ws
 * connection, and the real service registry behind it. The fixture config
 * lives OUTSIDE the default global dir, so a service that drops the `config`
 * option initializes against the default config instead and the fixture
 * model name never reaches the wire.
 */
const FIXTURE_MODEL = "webui-config-model";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return data;
}

async function startService(
  options: Parameters<WebUiServiceType["start"]>[0],
): Promise<{ service: WebUiServiceType; port: number; token: string }> {
  vi.resetModules();
  const { WebUiService } = await import("./WebUiService.js");
  const service = new WebUiService();
  cleanups.push(() => service.close());
  const handle = await service.start({ port: 0, ...options });
  return { service, port: handle.port, token: handle.token };
}

async function readModelView(
  port: number,
  token: string,
): Promise<ModelSelectionView> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`,
  );
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();
  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      onData.fire(VSBuffer.wrap(toUint8Array(data)));
    }
  });
  ws.on("close", () => {
    onClose.fire();
    onEnd.fire();
  });
  ws.on("error", () => {
    onClose.fire();
    onEnd.fire();
  });
  const socket: ISocket = {
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write(buffer: VSBuffer): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer.buffer);
      }
    },
    end(): void {
      ws.close();
    },
    drain(): Promise<void> {
      return Promise.resolve();
    },
    dispose(): void {
      ws.close();
    },
  };
  const protocol = new SocketProtocol(socket);
  const client = new ChannelClient(protocol);
  const initialized = new Promise<void>((resolve) => {
    client.onDidInitialize(() => resolve());
  });
  cleanups.push(() => {
    client.dispose();
    protocol.dispose();
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
  });
  await initialized;
  return client
    .getChannel(IModelSelectionService.channelName)
    .call<ModelSelectionView>("getView");
}

function modelIds(view: ModelSelectionView): string[] {
  return view.providers.flatMap((provider) =>
    provider.models.map((model) => model.modelId),
  );
}

describe("WebUiService model source", () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-webui-config-"));
    cleanups.push(() =>
      fs.rmSync(fixtureDir, { recursive: true, force: true }),
    );
  });

  it("serves the models from the config named by the config option", async () => {
    const fixturePath = path.join(fixtureDir, "config.yaml");
    fs.writeFileSync(
      fixturePath,
      [
        "name: WebUi Fixture",
        "version: 1.0.0",
        "schema: v1",
        "models:",
        `  - name: ${FIXTURE_MODEL}`,
        "    provider: openai",
        "    model: gpt-4",
        "    apiKey: test-key",
        "    roles:",
        "      - chat",
        "",
      ].join("\n"),
    );

    const { port, token } = await startService({ config: fixturePath });

    const view = await readModelView(port, token);
    expect(modelIds(view)).toContain(FIXTURE_MODEL);
    expect(view.preferredSelection?.modelId).toBe(FIXTURE_MODEL);
  });

  it("lazily reads the default config when no config option is given", async () => {
    writeMinimalConfig();

    const { port, token } = await startService({});

    const view = await readModelView(port, token);
    expect(modelIds(view)).toContain("test-model");
  });
});
