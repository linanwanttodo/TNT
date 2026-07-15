import { createContext, useContext, type ReactNode } from "react";

import type { CodingPlanUpgradeDialogTarget } from "@/settings/codingPlanUpgradeLoginRecovery.js";

interface CodingPlanUpgradeDialogContextValue {
  inventory: {
    entryPlanList: string;
    status: "loading" | "error" | "ready";
    retry: () => void;
  };
  openCodingPlanUpgrade: (
    target: CodingPlanUpgradeDialogTarget,
    observation?: { signal: AbortSignal; onResult: (opened: boolean) => void },
  ) => boolean;
}

const inventory: CodingPlanUpgradeDialogContextValue["inventory"] = {
  entryPlanList: "",
  status: "ready",
  retry: () => undefined,
};

const value: CodingPlanUpgradeDialogContextValue = {
  inventory,
  openCodingPlanUpgrade: (_target, observation) => {
    observation?.onResult(false);
    return false;
  },
};

const CodingPlanUpgradeDialogContext =
  createContext<CodingPlanUpgradeDialogContextValue>(value);

export function CodingPlanUpgradeDialogProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useCodingPlanUpgradeDialog() {
  return useContext(CodingPlanUpgradeDialogContext);
}

export function useOptionalCodingPlanUpgradeDialog() {
  return useContext(CodingPlanUpgradeDialogContext);
}
