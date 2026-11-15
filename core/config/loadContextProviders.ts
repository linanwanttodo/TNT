import {
  AssistantUnrolledNonNullable,
  ConfigValidationError,
} from "@tnt/config-yaml";
import { IContextProvider, IdeType } from "..";

/*
    Loads context providers based on configuration
    - default providers will always be loaded, using config params if present
    - other providers will be loaded if configured

    NOTE the MCPContextProvider is added in doLoadConfig if any resources are present

    The provider registry is loaded on first call, never at import time. This
    module is reached statically by `config/load.ts`, so an eager import here
    decides what the config path evaluates: the barrel exports all 29 providers
    and the concrete classes pull their own dependencies in with them.
    `core/staticImportBoundary.vitest.ts` holds the boundary.
*/
export async function loadConfigContextProviders(
  configContext: AssistantUnrolledNonNullable["context"],
  hasDocs: boolean,
  ideType: IdeType,
): Promise<{
  providers: IContextProvider[];
  errors: ConfigValidationError[];
}> {
  const [
    { contextProviderClassFromName },
    { default: CurrentFileContextProvider },
    { default: DiffContextProvider },
    { default: DocsContextProvider },
    { default: FileContextProvider },
    { default: ProblemsContextProvider },
    { default: RulesContextProvider },
    { default: TerminalContextProvider },
  ] = await Promise.all([
    import("../context/providers"),
    import("../context/providers/CurrentFileContextProvider"),
    import("../context/providers/DiffContextProvider"),
    import("../context/providers/DocsContextProvider"),
    import("../context/providers/FileContextProvider"),
    import("../context/providers/ProblemsContextProvider"),
    import("../context/providers/RulesContextProvider"),
    import("../context/providers/TerminalContextProvider"),
  ]);

  const providers: IContextProvider[] = [];
  const errors: ConfigValidationError[] = [];

  const defaultProviders: IContextProvider[] = [
    new FileContextProvider({}),
    new CurrentFileContextProvider({}),
    new DiffContextProvider({}),
    new TerminalContextProvider({}),
    new ProblemsContextProvider({}),
    new RulesContextProvider({}),
  ];

  // Add from config
  if (configContext) {
    for (const config of configContext) {
      const cls = contextProviderClassFromName(config.provider) as any;
      if (
        !cls &&
        !defaultProviders.find((p) => p.description.title === config.provider)
      ) {
        errors.push({
          fatal: false,
          message: `Unknown context provider ${config.provider}`,
        });
        continue;
      }
      providers.push(
        new cls({
          name: config.name,
          ...config.params,
        }),
      );
    }
  }

  // Add from defaults if not found in config
  for (const defaultProvider of defaultProviders) {
    if (
      !providers.find(
        (p) => p.description.title === defaultProvider.description.title,
      )
    ) {
      providers.push(defaultProvider);
    }
  }

  if (hasDocs && !providers?.some((cp) => cp.description.title === "docs")) {
    providers.push(new DocsContextProvider({}));
  }

  // @problems and @terminal are not supported in jetbrains
  const filteredProviders = providers.filter((pv) => {
    if (ideType === "jetbrains") {
      return (
        pv.description.title !== TerminalContextProvider.description.title &&
        pv.description.title !== ProblemsContextProvider.description.title
      );
    }
    return true;
  });

  return {
    providers: filteredProviders,
    errors,
  };
}
