import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  FetchFunction,
} from "../../index.js";
import { fetchFavicon } from "../../util/fetchFavicon";

class URLContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "url",
    displayTitle: "URL",
    description: "Reference a webpage at a given URL",
    type: "query",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return await getUrlContextItems(query, extras.fetch);
  }
}

export default URLContextProvider;

export async function getUrlContextItems(
  query: string,
  fetchFn: FetchFunction,
): Promise<ContextItem[]> {
  const url = new URL(query);
  const icon = await fetchFavicon(url);
  const resp = await fetchFn(url);

  // Check if the response is not OK
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();

  // Parsing one URL is a rare path; JSDOM and the readability stack are
  // several megabytes that startup must not pay for.
  const [{ JSDOM }, { Readability }, { NodeHtmlMarkdown }] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
    import("node-html-markdown"),
  ]);
  const dom = new JSDOM(html);
  let reader = new Readability(dom.window.document);
  let article = reader.parse();
  const content = article?.content || "";
  const markdown = NodeHtmlMarkdown.translate(
    content,
    {},
    undefined,
    undefined,
  );

  const title = article?.title || url.pathname;

  return [
    {
      icon,
      description: url.toString(),
      content: markdown,
      name: title,
      uri: {
        type: "url",
        value: url.toString(),
      },
    },
  ];
}
