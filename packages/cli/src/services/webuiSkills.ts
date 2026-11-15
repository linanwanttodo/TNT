import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

import type { ISkillsService } from "@zcode/services";
import type {
  SkillDiagnostic,
  SkillScope,
  SkillSummary,
  SkillsListResult,
} from "@zcode/shared";

import { globalDir } from "../config/globalDir.js";
import { loadMarkdownSkills, type Skill } from "../utils/loadMarkdownSkills.js";
import { setSkillEnabled } from "../utils/skillsState.js";

const UNAVAILABLE = "ZCODE_UNAVAILABLE";

function within(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(resolvedRoot + path.sep)
  );
}

function realWithin(target: string, root: string): boolean {
  let resolved: string;
  let resolvedRoot: string;
  try {
    resolved = realpathSync(target);
    resolvedRoot = realpathSync(root);
  } catch {
    return false;
  }
  return (
    resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
  );
}

function workspaceSkillRoots(workspacePath: string): string[] {
  return [
    path.join(workspacePath, ".tnt", "skills"),
    path.join(workspacePath, ".claude", "skills"),
  ];
}

function userSkillRoot(): string {
  return path.join(globalDir(), "skills");
}

function pluginRoot(): string {
  return path.join(globalDir(), "plugins");
}

function scopeOf(absolutePath: string, workspacePath: string): SkillScope {
  if (
    workspaceSkillRoots(workspacePath).some((root) =>
      within(absolutePath, root),
    )
  ) {
    return "workspace";
  }
  if (within(absolutePath, pluginRoot())) {
    return "plugin";
  }
  return "user";
}

function pluginNameOf(absolutePath: string): string | undefined {
  const relative = path.relative(pluginRoot(), absolutePath);
  const first = relative.split(path.sep)[0];
  return first && !first.startsWith("..") ? first : undefined;
}

function toSummary(skill: Skill, workspacePath: string): SkillSummary {
  const absolutePath =
    skill.absolutePath ?? path.resolve(workspacePath, skill.path);
  const scope = scopeOf(absolutePath, workspacePath);
  return {
    id: absolutePath,
    name: skill.name,
    description: skill.description,
    body: skill.content,
    path: absolutePath,
    sourcePath: absolutePath,
    scope,
    enabled: skill.enabled !== false,
    ...(scope === "plugin" && pluginNameOf(absolutePath)
      ? {
          pluginName: pluginNameOf(absolutePath),
          pluginId: pluginNameOf(absolutePath),
        }
      : {}),
  };
}

function diagnosticsFrom(
  errors: { fatal: boolean; message: string }[],
): SkillDiagnostic[] {
  return errors.map((error) => ({
    code: "skill_read_failed",
    severity: (error.fatal
      ? "error"
      : "warning") as SkillDiagnostic["severity"],
    message: error.message,
  }));
}

function skillDirectory(absoluteSkillFile: string): string {
  return path.dirname(absoluteSkillFile);
}

function commonSkillsRoot(workspacePath: string): string {
  return path.join(workspacePath, ".tnt", "skills");
}

/** A read-only view: every discovered skill, its state, and the parse errors. */
export function createTntSkillsService(): ISkillsService {
  return {
    async list({ workspacePath }): Promise<SkillsListResult> {
      const { skills, errors } = await loadMarkdownSkills(workspacePath);
      return {
        skills: skills.map((skill) => toSummary(skill, workspacePath)),
        capability: { userScopeAvailable: true },
        diagnostics: diagnosticsFrom(errors),
      };
    },

    async setEnabled({ skillId, enabled, workspacePath }) {
      if (!within(skillId, globalDir()) && !within(skillId, workspacePath)) {
        throw new Error(
          `${UNAVAILABLE}: skills: ${skillId} is outside this machine's skill roots`,
        );
      }
      if (scopeOf(skillId, workspacePath) === "plugin") {
        throw new Error(
          `${UNAVAILABLE}: skills: plugin skills are enabled with their plugin`,
        );
      }
      setSkillEnabled(skillId, enabled);
    },

    async buildPromptContext({ prompt }) {
      // TNT skills are slash commands, not prompt-injected context. Reporting
      // none is the honest answer; the composer still runs /skill-name.
      return { prompt, activatedSkillNames: [] };
    },

    async copyToCommon({ workspacePath, skillId }) {
      if (!existsSync(skillId)) {
        throw new Error(`${UNAVAILABLE}: skills: ${skillId} does not exist`);
      }
      const root = commonSkillsRoot(workspacePath);
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const destination = path.join(
        root,
        path.basename(skillDirectory(skillId)),
      );
      if (within(skillId, root)) {
        return { newPath: skillId };
      }
      cpSync(skillDirectory(skillId), destination, {
        recursive: true,
        errorOnExist: false,
        force: true,
      });
      return { newPath: path.join(destination, "SKILL.md") };
    },

    async removeFromCommon({ workspacePath, skillId }) {
      const root = commonSkillsRoot(workspacePath);
      if (!realWithin(skillId, root)) {
        throw new Error(
          `${UNAVAILABLE}: skills: only a skill in ${root} can be removed from the common directory`,
        );
      }
      rmSync(skillDirectory(skillId), { recursive: true, force: true });
    },

    async deleteSkill({ workspacePath, skillId }) {
      const scope = scopeOf(skillId, workspacePath);
      if (scope === "plugin") {
        throw new Error(
          `${UNAVAILABLE}: skills: a plugin skill is removed with its plugin`,
        );
      }
      const roots = [...workspaceSkillRoots(workspacePath), userSkillRoot()];
      const root = roots.find((candidate) => realWithin(skillId, candidate));
      if (!root) {
        throw new Error(
          `${UNAVAILABLE}: skills: ${skillId} is not in a workspace or user skill directory`,
        );
      }
      const directory = skillDirectory(skillId);
      if (realpathSync(directory) === realpathSync(root)) {
        throw new Error(
          `${UNAVAILABLE}: skills: refusing to delete a skill root`,
        );
      }
      if (!statSync(directory).isDirectory()) {
        throw new Error(
          `${UNAVAILABLE}: skills: ${skillId} is not a directory`,
        );
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
