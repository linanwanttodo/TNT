import { randomUUID } from "crypto";
import fs from "fs";
/* eslint-disable max-lines */
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import path from "path";

import * as acp from "@agentclientprotocol/sdk";

import { assertSessionId } from "../session/paths.js";
import { sessionStore } from "../session/store.js";
import { configureConsoleForHeadless, safeStderr } from "../startup/init.js";
import { getVersion } from "../startup/version.js";
import { logger } from "../utils/logger.js";

import { authMethodsFor } from "./auth.js";
import { internalError, invalidParams, sessionNotFound } from "./errors.js";
import { createStdioStream } from "./transport.js";

export interface SupervisorOptions {
  configPath?: string;
  trustProject?: boolean;
}

interface WorkerEntry {
  sessionId: string;
  cwd: string;
  mcpServers: acp.McpServer[];
  additionalDirectories: string[];
  child: ChildProcess;
  client: acp.ClientConnection;
  ctx: acp.ClientContext;
  alive: boolean;
  active: boolean;
  modes?: acp.SessionModeState | null;
  configOptions?: acp.SessionConfigOption[] | null;
}

interface SessionCatalogEntry {
  cwd: string;
  mcpServers: acp.McpServer[];
  additionalDirectories: string[];
}

function workerEntry(): string {
  const entry = process.env.TNT_ACP_WORKER_ENTRY ?? process.argv[1];
  if (!entry) {
    throw internalError(
      "Cannot locate the CLI entry point for an ACP session worker",
    );
  }
  return entry;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      child.off("exit", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    child.once("exit", done);
  });
}

function assertAdditionalDirectories(directories?: string[] | null): void {
  for (const directory of directories ?? []) {
    if (!path.isAbsolute(directory)) {
      throw invalidParams(
        `additionalDirectories must be absolute: ${directory}`,
      );
    }
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw invalidParams(`additionalDirectories does not exist: ${directory}`);
    }
  }
}

export async function runAcpSupervisor(
  options: SupervisorOptions = {},
): Promise<void> {
  configureConsoleForHeadless(true);
  logger.configureHeadlessMode(true);

  const app = acp.agent({ name: "tnt" });
  const workers = new Map<string, WorkerEntry>();
  const catalog = new Map<string, SessionCatalogEntry>();
  const clientCapabilitiesRef: { value?: acp.ClientCapabilities } = {};
  const realConnectionRef: { value?: acp.AgentConnection } = {};

  const capabilities = (): acp.AgentCapabilities => ({
    loadSession: true,
    promptCapabilities: {
      image: true,
      audio: true,
      embeddedContext: true,
    },
    mcpCapabilities: {
      http: true,
      sse: true,
    },
    sessionCapabilities: {
      list: {},
      delete: {},
      resume: {},
      close: {},
    },
  });

  const killAll = () => {
    for (const entry of workers.values()) {
      if (entry.alive) entry.child.kill("SIGTERM");
    }
  };
  process.once("exit", killAll);

  const stopWorker = async (entry: WorkerEntry): Promise<void> => {
    if (entry.alive) {
      entry.child.kill("SIGTERM");
      await waitForExit(entry.child, 2_000);
      if (entry.child.exitCode === null) {
        entry.child.kill("SIGKILL");
        await waitForExit(entry.child, 1_000);
      }
      entry.alive = false;
    }
    entry.client.close();
    if (workers.get(entry.sessionId) === entry) {
      workers.delete(entry.sessionId);
    }
  };

  const spawnWorker = async (
    sessionId: string,
    cwd: string,
    mcpServers: acp.McpServer[],
    additionalDirectories: string[],
  ): Promise<WorkerEntry> => {
    const entryPath = path.resolve(workerEntry());
    const entryDir = path.dirname(entryPath);
    const configPath = options.configPath
      ? path.resolve(options.configPath)
      : undefined;
    const args = [
      ...process.execArgv,
      entryPath,
      "--acp-worker",
      "--session-id",
      sessionId,
      "--session-cwd",
      cwd,
    ];
    if (configPath) args.push("--config", configPath);

    const child = spawn(process.execPath, args, {
      // Start from the CLI's own directory so a dev loader (tsx) resolves;
      // the worker chdirs into the session cwd before it loads config or tools.
      cwd: entryDir,
      env: {
        ...process.env,
        TNT_ACP_WORKER: "1",
        ...(options.trustProject ? { TNT_TRUST_PROJECT: "1" } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr?.on("data", (chunk) => {
      safeStderr(String(chunk));
    });

    if (!child.stdin || !child.stdout) {
      child.kill("SIGKILL");
      throw internalError("Could not open the ACP worker's stdio");
    }

    const clientApp = acp.client({ name: "tnt-supervisor" });
    clientApp.onNotification(
      acp.methods.client.session.update,
      async (context) => {
        if (!realConnectionRef.value) return;
        await realConnectionRef.value.client.notify(
          acp.methods.client.session.update,
          context.params,
        );
      },
    );
    clientApp.onRequest(
      acp.methods.client.session.requestPermission,
      async (context) => {
        if (!realConnectionRef.value) {
          throw internalError("The ACP client is not connected");
        }
        return await realConnectionRef.value.client.request(
          acp.methods.client.session.requestPermission,
          context.params,
          { cancellationSignal: context.signal },
        );
      },
    );
    clientApp.onRequest(acp.methods.client.fs.readTextFile, async (context) => {
      if (!realConnectionRef.value) {
        throw internalError("The ACP client is not connected");
      }
      return await realConnectionRef.value.client.request(
        acp.methods.client.fs.readTextFile,
        context.params,
        { cancellationSignal: context.signal },
      );
    });
    clientApp.onRequest(
      acp.methods.client.fs.writeTextFile,
      async (context) => {
        if (!realConnectionRef.value) {
          throw internalError("The ACP client is not connected");
        }
        return await realConnectionRef.value.client.request(
          acp.methods.client.fs.writeTextFile,
          context.params,
          { cancellationSignal: context.signal },
        );
      },
    );
    clientApp.onRequest(acp.methods.client.terminal.create, async (context) => {
      if (!realConnectionRef.value) {
        throw internalError("The ACP client is not connected");
      }
      return await realConnectionRef.value.client.request(
        acp.methods.client.terminal.create,
        context.params,
        { cancellationSignal: context.signal },
      );
    });
    clientApp.onRequest(acp.methods.client.terminal.output, async (context) => {
      if (!realConnectionRef.value) {
        throw internalError("The ACP client is not connected");
      }
      return await realConnectionRef.value.client.request(
        acp.methods.client.terminal.output,
        context.params,
        { cancellationSignal: context.signal },
      );
    });
    clientApp.onRequest(
      acp.methods.client.terminal.waitForExit,
      async (context) => {
        if (!realConnectionRef.value) {
          throw internalError("The ACP client is not connected");
        }
        return await realConnectionRef.value.client.request(
          acp.methods.client.terminal.waitForExit,
          context.params,
          { cancellationSignal: context.signal },
        );
      },
    );
    clientApp.onRequest(acp.methods.client.terminal.kill, async (context) => {
      if (!realConnectionRef.value) {
        throw internalError("The ACP client is not connected");
      }
      return await realConnectionRef.value.client.request(
        acp.methods.client.terminal.kill,
        context.params,
        { cancellationSignal: context.signal },
      );
    });
    clientApp.onRequest(
      acp.methods.client.terminal.release,
      async (context) => {
        if (!realConnectionRef.value) {
          throw internalError("The ACP client is not connected");
        }
        return await realConnectionRef.value.client.request(
          acp.methods.client.terminal.release,
          context.params,
          { cancellationSignal: context.signal },
        );
      },
    );

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const client = clientApp.connect(stream);
    const ctx = client.agent;

    const entry: WorkerEntry = {
      sessionId,
      cwd,
      mcpServers,
      additionalDirectories,
      child,
      client,
      ctx,
      alive: true,
      active: false,
    };
    workers.set(sessionId, entry);

    child.once("exit", () => {
      entry.alive = false;
    });
    void client.closed.then(() => {
      entry.alive = false;
    });

    try {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: clientCapabilitiesRef.value,
        clientInfo: {
          name: "tnt-supervisor",
          version: getVersion(),
        },
      });
    } catch (error) {
      await stopWorker(entry);
      throw internalError(
        `ACP session worker failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    catalog.set(sessionId, { cwd, mcpServers, additionalDirectories });
    return entry;
  };

  const ensureWorker = async (sessionId: string): Promise<WorkerEntry> => {
    assertSessionId(sessionId);
    const existing = workers.get(sessionId);
    if (existing?.alive) return existing;
    if (existing) await stopWorker(existing);

    const known = catalog.get(sessionId);
    const meta = sessionStore.getMeta(sessionId);
    if (!known && !meta) throw sessionNotFound(sessionId);
    const cwd = known?.cwd ?? meta!.workspaceDirectory;
    if (!cwd) throw sessionNotFound(sessionId);
    const mcpServers = known?.mcpServers ?? [];
    const additionalDirectories = known?.additionalDirectories ?? [];

    const entry = await spawnWorker(
      sessionId,
      cwd,
      mcpServers,
      additionalDirectories,
    );
    try {
      await entry.ctx.request(acp.methods.agent.session.resume, {
        sessionId,
        cwd,
        mcpServers,
        additionalDirectories,
      });
      return entry;
    } catch (error) {
      await stopWorker(entry);
      throw error;
    }
  };

  app.onRequest(acp.methods.agent.initialize, async (context) => {
    clientCapabilitiesRef.value = context.params.clientCapabilities;
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: {
        name: "tnt",
        title: "TNT CLI",
        version: getVersion(),
      },
      authMethods: authMethodsFor(context.params.clientCapabilities),
      agentCapabilities: capabilities(),
    } satisfies acp.InitializeResponse;
  });

  app.onRequest(acp.methods.agent.authenticate, async () => ({}));

  app.onRequest(acp.methods.agent.session.new, async (context) => {
    assertAdditionalDirectories(context.params.additionalDirectories);
    const cwd = path.resolve(context.params.cwd);
    if (!path.isAbsolute(context.params.cwd)) {
      throw invalidParams("session/new cwd must be absolute");
    }
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw invalidParams(`session/new cwd does not exist: ${cwd}`);
    }
    const sessionId = randomUUID();
    const mcpServers = context.params.mcpServers ?? [];
    const additionalDirectories = context.params.additionalDirectories ?? [];
    const entry = await spawnWorker(
      sessionId,
      cwd,
      mcpServers,
      additionalDirectories,
    );
    try {
      const response = await entry.ctx.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers,
        additionalDirectories: context.params.additionalDirectories,
      });
      entry.modes = response.modes;
      entry.configOptions = response.configOptions;
      return {
        sessionId,
        modes: response.modes ?? null,
        configOptions: response.configOptions ?? null,
      } satisfies acp.NewSessionResponse;
    } catch (error) {
      await stopWorker(entry);
      // The client never received this id; do not leave an empty session in
      // the listing after a failed creation.
      sessionStore.delete(sessionId, { force: true });
      throw error;
    }
  });

  app.onRequest(acp.methods.agent.session.load, async (context) => {
    assertSessionId(context.params.sessionId);
    assertAdditionalDirectories(context.params.additionalDirectories);
    const existing = workers.get(context.params.sessionId);
    if (existing?.alive) {
      return {
        modes: existing.modes ?? null,
        configOptions: existing.configOptions ?? null,
      };
    }
    const cwd = path.resolve(context.params.cwd);
    const mcpServers = context.params.mcpServers ?? [];
    const additionalDirectories = context.params.additionalDirectories ?? [];
    const entry = await spawnWorker(
      context.params.sessionId,
      cwd,
      mcpServers,
      additionalDirectories,
    );
    try {
      const response = await entry.ctx.request(acp.methods.agent.session.load, {
        sessionId: context.params.sessionId,
        cwd,
        mcpServers,
        additionalDirectories: context.params.additionalDirectories,
      });
      entry.modes = response.modes;
      entry.configOptions = response.configOptions;
      return {
        modes: response.modes ?? null,
        configOptions: response.configOptions ?? null,
      };
    } catch (error) {
      await stopWorker(entry);
      throw error;
    }
  });

  app.onRequest(acp.methods.agent.session.resume, async (context) => {
    assertSessionId(context.params.sessionId);
    assertAdditionalDirectories(context.params.additionalDirectories);
    const existing = workers.get(context.params.sessionId);
    if (existing?.alive) {
      return {
        modes: existing.modes ?? null,
        configOptions: existing.configOptions ?? null,
      };
    }
    const cwd = path.resolve(context.params.cwd);
    const mcpServers = context.params.mcpServers ?? [];
    const additionalDirectories = context.params.additionalDirectories ?? [];
    const entry = await spawnWorker(
      context.params.sessionId,
      cwd,
      mcpServers,
      additionalDirectories,
    );
    try {
      const response = await entry.ctx.request(
        acp.methods.agent.session.resume,
        {
          sessionId: context.params.sessionId,
          cwd,
          mcpServers,
          additionalDirectories: context.params.additionalDirectories,
        },
      );
      entry.modes = response.modes;
      entry.configOptions = response.configOptions;
      return {
        modes: response.modes ?? null,
        configOptions: response.configOptions ?? null,
      };
    } catch (error) {
      await stopWorker(entry);
      throw error;
    }
  });

  app.onRequest(acp.methods.agent.session.prompt, async (context) => {
    const entry = await ensureWorker(context.params.sessionId);
    if (entry.active) {
      throw invalidParams("Session already has an active prompt");
    }
    entry.active = true;
    try {
      return await entry.ctx.request(
        acp.methods.agent.session.prompt,
        context.params,
        { cancellationSignal: context.signal },
      );
    } catch (error) {
      if (!entry.alive) {
        await stopWorker(entry);
        throw internalError("ACP session worker exited during the prompt");
      }
      throw error;
    } finally {
      entry.active = false;
    }
  });

  app.onNotification(acp.methods.agent.session.cancel, async (context) => {
    const entry = workers.get(context.params.sessionId);
    if (!entry?.alive) return;
    await entry.ctx
      .notify(acp.methods.agent.session.cancel, context.params)
      .catch((error) => {
        logger.warn("Could not forward ACP session cancel", { error });
      });
  });

  app.onRequest(acp.methods.agent.session.setMode, async (context) => {
    const entry = await ensureWorker(context.params.sessionId);
    return await entry.ctx.request(
      acp.methods.agent.session.setMode,
      context.params,
    );
  });

  app.onRequest(acp.methods.agent.session.setConfigOption, async (context) => {
    const entry = await ensureWorker(context.params.sessionId);
    const response = await entry.ctx.request(
      acp.methods.agent.session.setConfigOption,
      context.params,
    );
    entry.configOptions = response.configOptions;
    return response;
  });

  app.onRequest(acp.methods.agent.session.list, async (context) => {
    const sessions = sessionStore.list({
      cwd: context.params.cwd ?? undefined,
      includeEmpty: true,
    });
    return {
      sessions: sessions.map((meta) => {
        const additionalDirectories = catalog.get(
          meta.sessionId,
        )?.additionalDirectories;
        return {
          sessionId: meta.sessionId,
          cwd: meta.workspaceDirectory,
          title: meta.title,
          updatedAt: meta.updatedAt,
          ...(additionalDirectories && additionalDirectories.length > 0
            ? { additionalDirectories }
            : {}),
        };
      }),
    } satisfies acp.ListSessionsResponse;
  });

  app.onRequest(acp.methods.agent.session.close, async (context) => {
    assertSessionId(context.params.sessionId);
    const entry = workers.get(context.params.sessionId);
    if (entry) await stopWorker(entry);
    catalog.delete(context.params.sessionId);
    return {};
  });

  app.onRequest(acp.methods.agent.session.delete, async (context) => {
    assertSessionId(context.params.sessionId);
    const entry = workers.get(context.params.sessionId);
    if (entry) await stopWorker(entry);
    catalog.delete(context.params.sessionId);
    sessionStore.delete(context.params.sessionId, { force: true });
    return {};
  });

  const connection = app.connect(createStdioStream());
  realConnectionRef.value = connection;

  const shutdown = async (): Promise<void> => {
    killAll();
    connection.close();
    for (const entry of [...workers.values()]) {
      await stopWorker(entry).catch(() => {});
    }
    process.exit(0);
  };
  const onSignal = () => {
    void shutdown();
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  // The editor closing stdin is the normal shutdown; closing the connection
  // lets `closed` settle so workers are stopped before this process exits.
  process.stdin.once("end", () => connection.close());
  process.stdin.once("close", () => connection.close());

  try {
    await connection.closed;
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    process.off("exit", killAll);
    for (const entry of [...workers.values()]) {
      await stopWorker(entry).catch(() => {});
    }
  }
}
