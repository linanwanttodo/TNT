import { describe, expect, it, vi } from "vitest";

vi.mock("./index.js");
vi.mock("../services/ModelService.js", () => ({}));

import * as config from "./index.js";

describe("probe", () => {
  it("automock keeps the export", () => {
    console.log(
      "AUTOMOCK TYPEOF:",
      typeof (config as any).applyOllamaContextWindow,
    );
    console.log("KEYS:", Object.keys(config).join(","));
    expect(true).toBe(true);
  });
});
