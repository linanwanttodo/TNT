import http from "http";
import type { AddressInfo } from "net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ChannelClient,
  Emitter,
  SocketProtocol,
  VSBuffer,
  type IChannel,
  type IDisposable,
  type ISocket,
} from "@zcode/rpc";
import {
  IZCodeAgentService,
  ISettingService,
  ServiceCollection,
} from "@zcode/services";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";

import {
  buildZcodeServiceCollection,
  ZCODE_LOCAL_SERVICE_DESCRIPTORS,
  ZCODE_OPTIONAL_SERVICE_DESCRIPTORS,
  ZCODE_REQUIRED_SERVICE_DESCRIPTORS,
} from "./serviceCollection.js";
import { disposeLocalZcodeServices } from "./services/local.js";
import { ZCODE_UNAVAILABLE_PREFIX } from "./services/stubs.js";
import { startWebUiZcodeHost, type ZcodeServicesSource } from "./wsHost.js";

const TOKEN = "test-webui-token";

let testGlobalDir: string;
let previousGlobalDir: string | undefined;

beforeAll(() => {
  previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  testGlobalDir = mkdtempSync(path.join(tmpdir(), "tnt-zcode-wshost-"));
  process.env.TNT_GLOBAL_DIR = testGlobalDir;
});

afterAll(() => {
  if (previousGlobalDir === undefined) {
    delete process.env.TNT_GLOBAL_DIR;
  } else {
    process.env.TNT_GLOBAL_DIR = previousGlobalDir;
  }
  rmSync(testGlobalDir, { recursive: true, force: true });
});

interface ZcodeClient {
  ws: WebSocket;
  client: ChannelClient;
  initialized: Promise<void>;
  closeTransport(): Promise<void>;
  dispose(): void;
}

interface TestServer {
  server: http.Server;
  port: number;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

afterAll(() => {
  // These tests go through the default process-wide bundle; release its
  // setting/watcher registry instead of leaving it to process exit.
  disposeLocalZcodeServices();
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

async function startTestServer(
  services: ZcodeServicesSource,
): Promise<TestServer> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const host = startWebUiZcodeHost({ server, token: TOKEN, services });

  const close = async (): Promise<void> => {
    await host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };
  cleanups.push(close);
  return { server, port: address.port, close };
}

function openClient(
  url: string,
  headers?: http.OutgoingHttpHeaders,
): ZcodeClient {
  const ws = new WebSocket(url, { headers });
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
  const closed = new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
  });

  const dispose = (): void => {
    client.dispose();
    protocol.dispose();
  };
  cleanups.push(async () => {
    dispose();
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
  });

  return {
    ws,
    client,
    initialized,
    async closeTransport(): Promise<void> {
      ws.close();
      await closed;
    },
    dispose,
  };
}

function channel(client: ChannelClient, name: string): IChannel {
  return client.getChannel(name);
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
  throw new Error("expected the promise to reject");
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("startWebUiZcodeHost", () => {
  it("answers an upgrade without a token with HTTP 401", async () => {
    const { port } = await startTestServer(() =>
      buildZcodeServiceCollection({ workspacePath: process.cwd() }),
    );
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    const status = await new Promise<number | undefined>((resolve) => {
      ws.on("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode);
      });
      ws.on("error", () => resolve(undefined));
      ws.on("close", () => resolve(undefined));
    });

    expect(status).toBe(401);
  });

  it("stays open with the session cookie and answers Initialize", async () => {
    const { port } = await startTestServer(() =>
      buildZcodeServiceCollection({ workspacePath: process.cwd() }),
    );
    const handle = openClient(`ws://127.0.0.1:${port}/ws`, {
      cookie: `tnt_webui_token=${TOKEN}`,
    });

    await handle.initialized;
    expect(handle.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("accepts the token from the query string", async () => {
    const { port } = await startTestServer(() =>
      buildZcodeServiceCollection({ workspacePath: process.cwd() }),
    );
    const handle = openClient(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(TOKEN)}`,
    );

    await handle.initialized;
    expect(handle.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("gives each connection its own service scope", async () => {
    const probe = createProbeAgent();
    let factoryCalls = 0;
    const services = (): ServiceCollection => {
      factoryCalls += 1;
      const collection = new ServiceCollection();
      collection.register(
        IZCodeAgentService,
        probe as unknown as IZCodeAgentService,
      );
      return collection;
    };
    const { port } = await startTestServer(services);
    const url = `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(TOKEN)}`;

    const first = openClient(url);
    await first.initialized;
    const firstAgent = channel(first.client, IZCodeAgentService.channelName);
    const receivedByFirst: number[] = [];
    const firstSubscription = firstAgent.listen("onDidPing")((
      value: unknown,
    ) => {
      receivedByFirst.push(value as number);
    });
    await waitFor(() => probe.subscriberCount() === 1, "first subscription");

    probe.ping(1);
    await waitFor(() => receivedByFirst.length === 1, "first event delivery");

    // Close the transport without disposing the client: the server must drop
    // the subscription itself when the socket ends.
    await first.closeTransport();
    await waitFor(
      () => probe.subscriberCount() === 0,
      "server-side subscription disposal",
    );

    // Issue the request while the transport is closed but the client is not
    // disposed, then dispose: the client must fail the in-flight request
    // closed instead of leaving it pending forever.
    const inFlight = channel(first.client, IZCodeAgentService.channelName).call(
      "readSession",
      [],
    );
    first.dispose();
    const afterClose = await rejection(inFlight);
    expect(afterClose.message).toBe("ChannelClient disposed");
    firstSubscription.dispose();

    const second = openClient(url);
    await second.initialized;
    const receivedBySecond: number[] = [];
    const secondSubscription = channel(
      second.client,
      IZCodeAgentService.channelName,
    ).listen("onDidPing")((value: unknown) => {
      receivedBySecond.push(value as number);
    });
    await waitFor(() => probe.subscriberCount() === 1, "second subscription");

    // A new scope starts empty: the event emitted for the first connection is
    // not replayed into the second.
    expect(receivedBySecond).toEqual([]);
    probe.ping(2);
    await waitFor(() => receivedBySecond.length === 1, "second event delivery");
    expect(receivedBySecond).toEqual([2]);

    secondSubscription.dispose();
    await second.closeTransport();
    probe.dispose();

    // One factory run per accepted upgrade: a shared scope would have built
    // once and let the second connection inherit the first's subscriptions.
    expect(factoryCalls).toBe(2);
  });

  it("disposes each connection scope when its socket closes", async () => {
    let disposals = 0;
    const services = (): ServiceCollection => {
      const collection = new ServiceCollection() as ServiceCollection & {
        dispose(): void;
      };
      collection.dispose = () => {
        disposals += 1;
      };
      return collection;
    };
    const { port } = await startTestServer(services);
    const url = `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(TOKEN)}`;

    for (let index = 1; index <= 2; index += 1) {
      const handle = openClient(url);
      await handle.initialized;
      await handle.closeTransport();
      await waitFor(
        () => disposals === index,
        `connection ${index} scope disposal`,
      );
    }

    expect(disposals).toBe(2);
  });

  it("rejects every stubbed required service with ZCODE_UNAVAILABLE", async () => {
    const { port } = await startTestServer(() =>
      buildZcodeServiceCollection({ workspacePath: process.cwd() }),
    );
    const handle = openClient(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(TOKEN)}`,
    );
    await handle.initialized;

    const localChannels = new Set(
      ZCODE_LOCAL_SERVICE_DESCRIPTORS.map(
        (descriptor) => descriptor.channelName,
      ),
    );
    const seen = new Set<string>();
    for (const descriptor of ZCODE_REQUIRED_SERVICE_DESCRIPTORS) {
      if (localChannels.has(descriptor.channelName)) continue;
      expect(seen.has(descriptor.channelName)).toBe(false);
      seen.add(descriptor.channelName);

      const error = await rejection(
        channel(handle.client, descriptor.channelName).call("__stubProbe__"),
      );
      expect(
        error.message.startsWith(
          `${ZCODE_UNAVAILABLE_PREFIX}${descriptor.channelName}`,
        ),
      ).toBe(true);
    }
    expect(seen.size).toBe(
      ZCODE_REQUIRED_SERVICE_DESCRIPTORS.length - localChannels.size,
    );
  });

  it("resolves settingService.get through the channel", async () => {
    // ZCodeIntlProvider calls get() without a catch on first paint; the real
    // setting service must answer AppSettings rather than reject.
    const { port } = await startTestServer(() =>
      buildZcodeServiceCollection({ workspacePath: process.cwd() }),
    );
    const handle = openClient(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(TOKEN)}`,
    );
    await handle.initialized;

    const settings = (await channel(
      handle.client,
      ISettingService.channelName,
    ).call("get")) as { recentProjects: unknown; locale: unknown };
    expect(Array.isArray(settings.recentProjects)).toBe(true);
    expect(typeof settings.locale).toBe("string");
  });

  it("registers optional channels so a stub call rejects without the timeout", async () => {
    // An unregistered channel waits out ChannelServer's 1000 ms timeout before
    // failing with "Unknown channel"; a mounted hook calling an optional
    // service on first paint pays that cost once per channel if it is missing.
    const { port } = await startTestServer(() =>
      buildZcodeServiceCollection({ workspacePath: process.cwd() }),
    );
    const handle = openClient(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(TOKEN)}`,
    );
    await handle.initialized;

    for (const descriptor of ZCODE_OPTIONAL_SERVICE_DESCRIPTORS) {
      const startedAt = Date.now();
      const error = await rejection(
        channel(handle.client, descriptor.channelName).call("__stubProbe__"),
      );

      expect(
        error.message.startsWith(
          `${ZCODE_UNAVAILABLE_PREFIX}${descriptor.channelName}`,
        ),
      ).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(1000);
    }
  });
});

function createProbeAgent(): {
  onDidPing: (listener: (value: number) => void) => IDisposable;
  readSession: () => Promise<never>;
  ping(value: number): void;
  subscriberCount(): number;
  dispose(): void;
} {
  const emitter = new Emitter<number>();
  let subscribers = 0;

  return {
    onDidPing(listener: (value: number) => void): IDisposable {
      subscribers += 1;
      const disposable = emitter.event(listener);
      return {
        dispose(): void {
          subscribers -= 1;
          disposable.dispose();
        },
      };
    },
    async readSession(): Promise<never> {
      throw new Error("probe");
    },
    ping(value: number): void {
      emitter.fire(value);
    },
    subscriberCount(): number {
      return subscribers;
    },
    dispose(): void {
      emitter.dispose();
    },
  };
}
