import type http from "http";
import type { Duplex } from "stream";

import {
  ChannelServer,
  Emitter,
  SocketProtocol,
  VSBuffer,
  type ISocket,
} from "@zcode/rpc";
import type { ServiceCollection } from "@zcode/services";
import type { Request } from "express";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { requestToken, tokenEquals } from "../services/webuiAuth.js";

const WS_PATH = "/ws";

export interface WebUiZcodeHost {
  close(): Promise<void>;
}

/**
 * Each connection needs its own service scope: a new ChannelServer disposes
 * the previous connection's subscriptions, so a reconnect must not inherit
 * them. The host therefore accepts either one collection or a per-connection
 * factory.
 */
export type ZcodeServicesSource = ServiceCollection | (() => ServiceCollection);

export interface StartWebUiZcodeHostOptions {
  server: http.Server;
  token: string;
  services: ZcodeServicesSource;
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return data;
}

function rawDataToBuffer(data: RawData): VSBuffer {
  return VSBuffer.wrap(toUint8Array(data));
}

/**
 * The server half of `client/src/websocket.ts`'s `wrapBrowserWebSocket`:
 * binary frames are the RPC stream, text frames are ignored, and closing the
 * socket ends the protocol.
 */
function wrapWebSocket(ws: WebSocket): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();

  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      onData.fire(rawDataToBuffer(data));
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

  return {
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
}

function bearerOrCookieToken(req: http.IncomingMessage): string | undefined {
  return requestToken(req as unknown as Request);
}

function tokenFromUpgrade(req: http.IncomingMessage): string | undefined {
  const fromHeaders = bearerOrCookieToken(req);
  if (fromHeaders !== undefined) {
    return fromHeaders;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("token") ?? undefined;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function handleConnection(ws: WebSocket, services: ServiceCollection): void {
  const socket = wrapWebSocket(ws);
  const protocol = new SocketProtocol(socket);
  const server = new ChannelServer(protocol, "server");
  services.exposeOnChannelServer(server);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    server.dispose();
    protocol.dispose();
    socket.dispose();
  };
  ws.once("close", dispose);
  ws.once("error", dispose);
}

/**
 * Attach the ZCode RPC channel host to an existing HTTP server at `/ws`.
 *
 * The upgrade is authenticated before it is accepted: a bad or missing token
 * is answered with HTTP 401 and the socket is destroyed, never upgraded and
 * gated afterwards. A rejected upgrade therefore cannot reach the RPC layer.
 */
export function startWebUiZcodeHost(
  options: StartWebUiZcodeHostOptions,
): WebUiZcodeHost {
  const wss = new WebSocketServer({ noServer: true });
  const servicesFor =
    typeof options.services === "function"
      ? options.services
      : (): ServiceCollection => options.services as ServiceCollection;

  const onUpgrade = (
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== WS_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const presented = tokenFromUpgrade(req) ?? "";
    if (!tokenEquals(presented, options.token)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, servicesFor());
    });
  };

  options.server.on("upgrade", onUpgrade);

  return {
    close(): Promise<void> {
      options.server.off("upgrade", onUpgrade);
      for (const client of wss.clients) {
        client.terminate();
      }
      return new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
