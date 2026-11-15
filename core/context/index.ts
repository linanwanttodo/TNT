import type {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  IContextProvider,
  LoadSubmenuItemsArgs,
} from "../index.js";

import { isSecurityConcern } from "../indexing/ignore.js";

export abstract class BaseContextProvider implements IContextProvider {
  options: { [key: string]: any };

  constructor(options: { [key: string]: any }) {
    this.options = options;
  }

  static description: ContextProviderDescription;

  get description(): ContextProviderDescription {
    return (this.constructor as any).description;
  }

  // Maybe just include the chat message in here. Should never have to go back to the context provider once you have the information.
  abstract getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]>;

  /**
   * The refusal a file-backed provider owes to a path that may hold credentials.
   *
   * It lives on the base because the failure it replaces was per-provider: one "cleanup file
   * security pr" commit deleted two providers' inline checks, left their imports unread, and
   * only the provider that still owned its own check kept refusing - three green lanes later,
   * `@file` and `@problems` were handing `.env` contents to the model. A provider now has one
   * call to make, and the check cannot be half-applied because it happens before the read.
   */
  protected redactSecurityConcern(
    uri: string,
    description: string,
    name?: string,
  ): ContextItem | null {
    if (!isSecurityConcern(uri)) {
      return null;
    }
    return {
      name: name ?? description,
      description,
      content:
        "Content redacted, this file cannot be viewed for security reasons",
      uri: {
        type: "file",
        value: uri,
      },
    };
  }

  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    return [];
  }

  get deprecationMessage(): string | null {
    return null;
  }
}
