import { beforeEach, describe, expect, it, vi } from "vitest";

const runHooks = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ blocked: false, results: [] })),
);

vi.mock("./hookRunner.js", () => ({
  runHooks: (...args: unknown[]) => runHooks(...args),
}));

import { HookService } from "./HookService.js";

beforeEach(() => {
  runHooks.mockClear();
});

class TestHookService extends HookService {
  constructor() {
    super();
    this.setState({
      config: { PreToolUse: [{ matcher: "Bash", hooks: [] }] },
      disabled: false,
      onceKeys: new Set(),
    });
  }
}

describe("HookService workspace", () => {
  it("runs a hook in the workspace carried by its event", async () => {
    const service = new TestHookService();

    await service.fireEvent({
      session_id: "session-1",
      transcript_path: "",
      cwd: "/tmp/child-worktree",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "pwd" },
    });

    expect(runHooks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cwd: "/tmp/child-worktree" }),
      "/tmp/child-worktree",
      expect.any(Set),
    );
  });
});
