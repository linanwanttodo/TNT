import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("TNT local Web UI", () => {
  it("does not set or read ZCode cloud capability flags", () => {
    const bootstrap = read("packages/zcode-ui/web/src/webuiBootstrap.tsx");
    expect(bootstrap).not.toContain("codingPlan:");
    expect(bootstrap).not.toContain("localProvidersOnly:");
    expect(bootstrap).not.toContain("setHostCapabilities");
    expect(() =>
      read("packages/zcode-ui/ui/src/host-capabilities.ts"),
    ).toThrow();
  });

  it("does not mount the account welcome, purchase dialog or rewards providers", () => {
    const rootShell = read("packages/zcode-ui/ui/src/Root.tsx");
    const appRoot = read("packages/zcode-ui/ui/src/App.tsx");

    expect(rootShell).not.toContain("<WelcomeScreen");
    expect(rootShell).not.toContain("welcomeScreenOpenReason");
    expect(rootShell).not.toContain("onLogin");
    expect(rootShell).not.toContain("onLogout");
    expect(appRoot).not.toContain("CodingPlanUpgradeDialogProvider");
    expect(appRoot).not.toContain("RewardsProvider");
    expect(appRoot).not.toContain("MarketingTouchProvider");
  });

  it("does not expose account, plan, login, logout or upgrade controls in the sidebar", () => {
    const footer = read("packages/zcode-ui/ui/src/WorkspaceSidebarFooter.tsx");

    expect(footer).not.toContain("onLogin");
    expect(footer).not.toContain("onLogout");
    expect(footer).not.toContain("onUpgradeClick");
    expect(footer).not.toContain("app.login");
    expect(footer).not.toContain("app.logout");
    expect(footer).not.toContain("rewards.menuTitle");
    expect(() =>
      read("packages/zcode-ui/ui/src/WorkspaceSidebarFooterUsageSummary.tsx"),
    ).toThrow();
  });

  it("sends skills, commands and hooks pages directly to their local sections", () => {
    const settings = read("packages/zcode-ui/ui/src/SettingsPage.tsx");

    expect(settings).toContain('activeSection === "skill"');
    expect(settings).toContain("<SkillsSection");
    expect(settings).toContain('activeSection === "commands"');
    expect(settings).toContain("<CommandsSection");
    const skillBranchStart = settings.indexOf('activeSection === "skill"');
    const migrationBranchStart = settings.indexOf(
      'activeSection === "migration"',
    );
    const skillBranch = settings.slice(skillBranchStart, migrationBranchStart);
    expect(skillBranch).toContain("<SkillsSection");
    expect(skillBranch).not.toContain("<PluginsSection");
    const commandsBranchStart = settings.indexOf(
      'activeSection === "commands"',
    );
    const hooksBranchStart = settings.indexOf('activeSection === "hooks"');
    const commandsBranch = settings.slice(
      commandsBranchStart,
      hooksBranchStart,
    );
    expect(commandsBranch).toContain("<CommandsSection");
    expect(commandsBranch).not.toContain("<PluginsSection");
  });

  it("registers the local skills, commands and hooks services in the web host", () => {
    const webUiService = read("packages/cli/src/services/WebUiService.ts");
    const collection = read("packages/cli/src/webuiZcode/serviceCollection.ts");

    for (const name of ["skillsService", "commandsService", "hooksService"]) {
      expect(webUiService).toContain(`const ${name} = createTnt`);
      expect(collection).toContain(
        `[I${name[0].toUpperCase()}${name.slice(1)}`,
      );
    }
  });

  it("does not expose cloud account stubs as visible product capabilities", () => {
    const bootstrap = read("packages/zcode-ui/web/src/webuiBootstrap.tsx");
    const settings = read(
      "packages/zcode-ui/ui/src/settings/settingsPageConfig.ts",
    );

    expect(bootstrap).not.toContain("ZCODE_UNAVAILABLE");
    expect(settings).not.toContain("codingPlan");
    expect(settings).not.toContain("account");
  });

  it("keeps local migration wizard wiring without cloud marketing UI", () => {
    const rootShell = read("packages/zcode-ui/ui/src/Root.tsx");
    const settings = read("packages/zcode-ui/ui/src/SettingsPage.tsx");
    const settingsSync = read(
      "packages/zcode-ui/ui/src/hooks/useSettingsSync.ts",
    );
    const collection = read("packages/cli/src/webuiZcode/serviceCollection.ts");

    expect(rootShell).toContain("<OnboardingDialog");
    expect(rootShell).toContain(
      "if (!workspaceShellPath && isSettingsTabActive) {",
    );
    expect(settings).toContain("onOpenMigration={requestMigrationDialog}");
    expect(settingsSync).toContain("getFirstRunPromptState()");
    expect(settingsSync).toContain("markFirstRunPromptHandled()");
    expect(collection).toContain("[ISettingsSyncService,");
    expect(() =>
      read(
        "packages/zcode-ui/ui/src/components/cloud-content-dialog/CloudContentDialog.tsx",
      ),
    ).toThrow();
    expect(() => read("packages/zcode-ui/ui/src/WelcomeScreen.tsx")).toThrow();
  });

  it("removes the remote-control, cloud-content and marketing service surfaces", () => {
    const bootstrap = read("packages/zcode-ui/web/src/webuiBootstrap.tsx");
    const platform = read("packages/zcode-ui/web/src/platform/index.ts");
    const sharedIndex = read("packages/zcode-ui/shared/src/index.ts");

    expect(bootstrap).not.toContain("webRemoteControl");
    expect(platform).not.toContain("startWebRemoteControl");
    expect(platform).not.toContain("externalWebRemoteControlProxy");
    expect(sharedIndex).not.toContain("web-remote-control.js");
    expect(sharedIndex).not.toContain("cloudContent.js");
    expect(sharedIndex).not.toContain("marketingTouch.js");
    expect(() =>
      read("packages/zcode-ui/ui/src/WebRemoteControlThemeMenu.tsx"),
    ).toThrow();
    expect(() =>
      read("packages/zcode-ui/ui/src/hooks/useWebRemoteControlStatus.ts"),
    ).toThrow();
    expect(() =>
      read("packages/zcode-ui/ui/src/hooks/useWebRemoteControlTaskOpen.ts"),
    ).toThrow();
    expect(() =>
      read("packages/zcode-ui/shared/src/cloudContent.ts"),
    ).toThrow();
    expect(() =>
      read("packages/zcode-ui/services/src/marketing-touch/marketingTouch.ts"),
    ).toThrow();
  });

  it("removes visible coding-plan upgrade controls", () => {
    expect(() =>
      read(
        "packages/zcode-ui/ui/src/settings/model-provider-section/CodingPlanStatusActions.tsx",
      ),
    ).toThrow();

    const statusCards = read(
      "packages/zcode-ui/ui/src/settings/model-provider-section/StatusCards.tsx",
    );
    expect(statusCards).not.toContain("CodingPlanUpgradeAction");
    expect(statusCards).not.toContain(
      "settings.modelProvider.codingPlan.upgrade",
    );
    expect(statusCards).not.toContain(
      "settings.modelProvider.codingPlan.subscribe",
    );

    const sidebar = read("packages/zcode-ui/ui/src/WorkspaceSidebarFooter.tsx");
    expect(sidebar).not.toContain("sidebar.usage.plan.openStats");
  });
});
