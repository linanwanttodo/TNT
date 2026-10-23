import * as acp from "@agentclientprotocol/sdk";

import {
  backgroundJobService,
  type BackgroundJobService,
} from "../services/BackgroundJobService.js";
import type {
  TerminalRunOptions,
  TerminalRunResult,
  TerminalRunner,
} from "../tools/terminalRunner.js";

const OUTPUT_BYTE_LIMIT = 200_000;

export interface AcpTerminalRunnerOptions {
  jobs?: BackgroundJobService;
}

/**
 * A command in the editor's terminal. The client owns the process, so the agent
 * reads its output and exit status over ACP. A command still running at the
 * timeout is not killed: it becomes a pollable background job and the editor
 * terminal stays open, which is also the only way a human can answer an
 * interactive prompt (ACP v1 has no stdin request).
 */
export function createAcpTerminalRunner(
  client: acp.AgentContext,
  sessionId: string,
  options: AcpTerminalRunnerOptions = {},
): TerminalRunner {
  const jobs = options.jobs ?? backgroundJobService;

  return {
    async run(
      runOptions: TerminalRunOptions,
      signal?: AbortSignal,
    ): Promise<TerminalRunResult> {
      const created = await client.request(
        acp.methods.client.terminal.create,
        {
          sessionId,
          command: runOptions.shell,
          args: runOptions.args,
          cwd: runOptions.cwd,
          outputByteLimit: OUTPUT_BYTE_LIMIT,
        },
        { cancellationSignal: signal },
      );
      const terminalId = created.terminalId;

      let released = false;
      const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        await client
          .request(acp.methods.client.terminal.release, {
            sessionId,
            terminalId,
          })
          .catch(() => {});
      };

      const readOutput = async (): Promise<string> => {
        const output = await client
          .request(
            acp.methods.client.terminal.output,
            { sessionId, terminalId },
            { cancellationSignal: signal },
          )
          .catch(() => ({ output: "", truncated: false }));
        return output.output;
      };

      let timer: NodeJS.Timeout | undefined;
      let background = false;
      const waitAbort = new AbortController();

      try {
        const exit = await Promise.race([
          client.request(
            acp.methods.client.terminal.waitForExit,
            { sessionId, terminalId },
            { cancellationSignal: waitAbort.signal },
          ),
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), runOptions.timeoutMs);
          }),
        ]);

        if (exit === "timeout") {
          waitAbort.abort();
          const output = await readOutput();
          const command = [runOptions.shell, ...runOptions.args].join(" ");

          const job = jobs.registerPolledJob(
            command,
            {
              poll: async () => {
                const current = await client.request(
                  acp.methods.client.terminal.output,
                  { sessionId, terminalId },
                );
                if (current.exitStatus) {
                  await release();
                  return {
                    done: true,
                    output: current.output,
                    exitCode: current.exitStatus.exitCode ?? null,
                    signal: current.exitStatus.signal ?? null,
                  };
                }
                return { done: false, output: current.output };
              },
              cancel: async () => {
                await client
                  .request(acp.methods.client.terminal.kill, {
                    sessionId,
                    terminalId,
                  })
                  .catch(() => {});
                await release();
              },
            },
            sessionId,
            output,
          );

          if (job) {
            background = true;
            return {
              output,
              timedOut: true,
              backgroundJobId: job.id,
            };
          }

          // The job limit is reached; this terminal cannot outlive the call.
          await client
            .request(acp.methods.client.terminal.kill, {
              sessionId,
              terminalId,
            })
            .catch(() => {});
          return { output, timedOut: true };
        }

        return {
          output: await readOutput(),
          exitCode: exit.exitCode,
          signal: exit.signal,
          timedOut: false,
        };
      } finally {
        if (timer) clearTimeout(timer);
        waitAbort.abort();
        if (!background) await release();
      }
    },

    async dispose(): Promise<void> {
      await jobs.cancelPolledJobs(sessionId);
    },
  };
}
