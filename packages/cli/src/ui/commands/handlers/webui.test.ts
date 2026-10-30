import { beforeEach, describe, expect, it, vi } from "vitest";

const { startSpy, closeSpy, openSpy } = vi.hoisted(() => ({
  startSpy: vi.fn(),
  closeSpy: vi.fn(async () => {}),
  openSpy: vi.fn(async () => {}),
}));

vi.mock("../../../services/WebUiService.js", () => ({
  webUiService: {
    start: startSpy,
    close: closeSpy,
  },
}));

vi.mock("open", () => ({ default: openSpy }));

import { handleWebui } from "./webui.js";

describe("handleWebui", () => {
  beforeEach(() => {
    startSpy.mockReset();
    closeSpy.mockClear();
    openSpy.mockClear();
  });

  it("closes the service for the stop argument", async () => {
    const result = await handleWebui(["stop"]);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).not.toHaveBeenCalled();
    expect(result.output).toBeTruthy();
  });

  it("starts without opening a browser for --no-open", async () => {
    startSpy.mockResolvedValue({ port: 47610, token: "tok" });

    const result = await handleWebui(["--no-open"]);

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ port: undefined }),
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(result.output).toContain("47610");
  });

  it("passes a --port=value argument through to start", async () => {
    startSpy.mockResolvedValue({ port: 47700, token: "tok" });

    await handleWebui(["--port=47700", "--no-open"]);

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ port: 47700 }),
    );
  });

  it("opens the tokened loopback URL by default", async () => {
    startSpy.mockResolvedValue({ port: 47610, token: "sekret" });

    const result = await handleWebui([]);

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:47610"),
    );
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("sekret"));
    expect(result.output).toContain("http://127.0.0.1:47610");
  });

  it("reports a start failure instead of throwing", async () => {
    startSpy.mockRejectedValue(
      new Error("Web UI could not find a free port: 47610 through 47709"),
    );

    const result = await handleWebui(["--no-open"]);

    expect(result.output).toContain("could not find a free port");
  });
});
