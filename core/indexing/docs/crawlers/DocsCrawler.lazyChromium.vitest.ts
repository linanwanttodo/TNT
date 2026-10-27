import { describe, expect, it, vi } from "vitest";

const constructed: string[] = [];

vi.mock("./ChromiumCrawler", () => ({
  ChromiumCrawler: class {
    constructor() {
      constructed.push("crawler");
    }

    crawl() {
      return (function* () {})();
    }
  },
  ChromiumInstaller: class {
    constructor() {
      constructed.push("installer");
    }

    isInstalled() {
      return false;
    }

    shouldProposeUseChromiumOnCrawlFailure() {
      return false;
    }
  },
}));

import DocsCrawler from "./DocsCrawler";

/**
 * The suite in `DocsCrawler.vitest.ts` is skipped: it crawls live sites and
 * downloads Chromium. These cases need neither. They pin the one property that
 * decides what a CLI run has to evaluate - a config that never asked for
 * Chromium must not reach the module that imports puppeteer.
 */
describe("loading the Chromium crawler", () => {
  it("does not touch the module when the config never opted in", async () => {
    const crawler = new DocsCrawler({} as any, { experimental: {} } as any);

    expect(constructed).toEqual([]);
    await expect((crawler as any).shouldUseChromium()).resolves.toEqual(false);
    expect(constructed).toEqual([]);
  });

  it("does not touch the module when there is no experimental block at all", async () => {
    const crawler = new DocsCrawler({} as any, {} as any);

    await expect((crawler as any).shouldUseChromium()).resolves.toEqual(false);
    expect(constructed).toEqual([]);
  });

  it("starts the installer straight away once the config opts in", async () => {
    const crawler = new DocsCrawler(
      {} as any,
      {
        experimental: { useChromiumForDocsCrawling: true },
      } as any,
    );

    // Constructing the installer is what kicks off the download, so it happens
    // on construction rather than at first crawl, as it did before.
    await (crawler as any).chromiumInstaller;

    expect(constructed).toContain("installer");
  });

  it("still declines Chromium when it was opted into but is not installed", async () => {
    const crawler = new DocsCrawler(
      {} as any,
      {
        experimental: { useChromiumForDocsCrawling: true },
      } as any,
    );

    await expect((crawler as any).shouldUseChromium()).resolves.toEqual(false);
  });
});
