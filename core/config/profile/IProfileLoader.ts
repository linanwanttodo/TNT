// ProfileHandlers manage the loading of a config, allowing us to abstract over different ways of getting to a TntConfig

import { ConfigResult } from "@tnt/config-yaml";
import { TntConfig } from "../../index.js";
import { ProfileDescription } from "../ProfileLifecycleManager.js";

// After we have the TntConfig, the ConfigHandler takes care of everything else (loading models, lifecycle, etc.)
export interface IProfileLoader {
  description: ProfileDescription;
  doLoadConfig(): Promise<ConfigResult<TntConfig>>;
  setIsActive(isActive: boolean): void;
}
