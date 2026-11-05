import { useEffect, useState } from "react";
import {
  fetchApprovals,
  fetchGitStatus,
  fetchWorkspaces,
  type GitStatus,
  type PendingPermissionSummary,
  type WorkspacesResponse,
} from "../../../api/client.js";

export function useWorkspaceRailData() {
  const [workspaces, setWorkspaces] = useState<WorkspacesResponse | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [approvals, setApprovals] = useState<PendingPermissionSummary[]>([]);

  useEffect(() => {
    void fetchWorkspaces()
      .then(setWorkspaces)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const load = () => {
      void fetchGitStatus()
        .then(setGit)
        .catch(() => {});
      void fetchApprovals()
        .then(setApprovals)
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  return { workspaces, git, approvals, setApprovals };
}
