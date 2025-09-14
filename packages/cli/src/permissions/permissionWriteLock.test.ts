import fs from "fs";
import os from "os";
import path from "path";

import { withPermissionWriteLock } from "./permissionWriteLock.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withPermissionWriteLock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-lock-"));
  let lockPath: string;
  let counter = 0;

  beforeEach(() => {
    lockPath = path.join(dir, `lock-${counter++}.lock`);
  });

  it("keeps a second writer out until the first releases", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withPermissionWriteLock(
      lockPath,
      async () => {
        order.push("first-start");
        await gate;
        order.push("first-end");
      },
      { pollMs: 5 },
    );
    await sleep(20);

    const second = withPermissionWriteLock(
      lockPath,
      async () => {
        order.push("second-start");
      },
      { pollMs: 5 },
    );
    await sleep(30);

    // The lock is what keeps this at "first-start": without it the second
    // body would already have run.
    expect(order).toEqual(["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("removes the lock file after the writer is done", async () => {
    await withPermissionWriteLock(lockPath, async () => {});
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("removes the lock file when the writer throws", async () => {
    await expect(
      withPermissionWriteLock(lockPath, async () => {
        throw new Error("writer failed");
      }),
    ).rejects.toThrow("writer failed");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("breaks a lock left behind by a process that is gone", async () => {
    fs.writeFileSync(lockPath, "");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, past, past);

    const ran = vi.fn();
    await withPermissionWriteLock(lockPath, ran, { staleMs: 1000 });

    expect(ran).toHaveBeenCalled();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("proceeds without the lock rather than blocking an approval forever", async () => {
    // A fresh lock nobody will release: live-looking, so it is not stolen.
    fs.writeFileSync(lockPath, "");

    const ran = vi.fn();
    await withPermissionWriteLock(lockPath, ran, {
      waitMs: 40,
      pollMs: 10,
      staleMs: 60_000,
    });

    expect(ran).toHaveBeenCalled();
    // The other writer's lock file is left alone.
    expect(fs.existsSync(lockPath)).toBe(true);
  });
});
