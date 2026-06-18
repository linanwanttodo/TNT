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
    // The tree refreshes on the same cadence as git/approvals: the agent
    // creates and edits files while a turn runs, so a fetch-once snapshot
    // goes stale within seconds.
    const load = () => {
      void fetchWorkspaces()
        .then(setWorkspaces)
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
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
