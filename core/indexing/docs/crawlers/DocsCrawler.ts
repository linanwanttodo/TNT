import { URL } from "node:url";

import { TntConfig, IDE } from "../../..";
import type { ChromiumInstaller } from "./ChromiumCrawler";

import CheerioCrawler from "./CheerioCrawler";
import GitHubCrawler from "./GitHubCrawler";

export type PageData = {
  url: string;
  path: string;
  content: string;
};

export type DocsCrawlerType = "cheerio" | "chromium" | "github";

class DocsCrawler {
  private readonly GITHUB_HOST = "github.com";
  private chromiumInstaller?: Promise<ChromiumInstaller>;

  constructor(
    private readonly ide: IDE,
    private readonly config: TntConfig,
    private readonly maxDepth: number = 4,
    private readonly maxRequestsPerCrawl: number = 1000,
    private readonly githubToken: string | undefined = undefined,
  ) {
    // Chromium pulls in puppeteer and its chromium-resolver, which a static
    // site never needs. Opting into Chromium is what starts the download, so
    // that part keeps happening here rather than at first crawl - the flag is
    // also what makes loading the module worth it.
    if (this.config.experimental?.useChromiumForDocsCrawling) {
      void this.getChromiumInstaller();
    }
  }

  private getChromiumInstaller(): Promise<ChromiumInstaller> {
    this.chromiumInstaller ??= import("./ChromiumCrawler").then(
      ({ ChromiumInstaller }) => new ChromiumInstaller(this.ide, this.config),
    );

    return this.chromiumInstaller;
  }

  private async shouldUseChromium() {
    if (!this.config.experimental?.useChromiumForDocsCrawling) {
      return false;
    }

    return (await this.getChromiumInstaller()).isInstalled();
  }

  /*
    Returns the type of crawler used in the end
  */
  async *crawl(
    startUrl: URL,
  ): AsyncGenerator<PageData, DocsCrawlerType, undefined> {
    if (startUrl.host === this.GITHUB_HOST) {
      yield* new GitHubCrawler(startUrl, this.githubToken).crawl();
      return "github";
    }

    if (await this.shouldUseChromium()) {
      const { ChromiumCrawler } = await import("./ChromiumCrawler");

      yield* new ChromiumCrawler(
        startUrl,
        this.maxRequestsPerCrawl,
        this.maxDepth,
      ).crawl();
      return "chromium";
    } else {
      let didCrawlSinglePage = false;

      for await (const pageData of new CheerioCrawler(
        startUrl,
        this.maxRequestsPerCrawl,
        this.maxDepth,
      ).crawl()) {
        yield pageData;
        didCrawlSinglePage = true;
      }

      // We assume that if we failed to crawl a single page,
      // it was due to an error that using Chromium can resolve
      const chromiumInstaller = await this.getChromiumInstaller();
      const shouldProposeUseChromium =
        !didCrawlSinglePage &&
        chromiumInstaller.shouldProposeUseChromiumOnCrawlFailure();

      if (shouldProposeUseChromium) {
        const didInstall = await chromiumInstaller.proposeAndAttemptInstall(
          startUrl.toString(),
        );

        if (didInstall) {
          void this.ide.showToast(
            "info",
            `Successfully installed Chromium! Retrying crawl of: ${startUrl.toString()}`,
          );

          const { ChromiumCrawler } = await import("./ChromiumCrawler");

          yield* new ChromiumCrawler(
            startUrl,
            this.maxRequestsPerCrawl,
            this.maxDepth,
          ).crawl();
          return "chromium";
        }
      }

      return "cheerio";
    }
  }
}

export default DocsCrawler;
// The Chromium classes are deliberately not re-exported: an `export { X } from
// "./ChromiumCrawler"` is a static import, and consumers take them from that
// module directly so that a crawler which never reaches Chromium keeps not
// loading it.
export { CheerioCrawler, GitHubCrawler };
