import {
  AcademicCapIcon,
  ArrowLeftIcon,
  BoltIcon,
  ChartBarIcon,
  CircleStackIcon,
  Cog6ToothIcon,
  CubeIcon,
  DocumentIcon,
  PencilIcon,
  QuestionMarkCircleIcon,
  ServerStackIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { ConfigSection } from "./components/ConfigSection";
import { ConfigsSection } from "./sections/ConfigsSection";
import { HelpSection } from "./sections/HelpSection";
import { IndexingSettingsSection } from "./sections/IndexingSettingsSection";
import { ModelsSection } from "./sections/ModelsSection";
import { RulesSection } from "./sections/RulesSection";
import { McpSection } from "./sections/McpSection";
import { RtkSection } from "./sections/RtkSection";
import { SkillsSection } from "./sections/SkillsSection";
import { ToolsSection } from "./sections/ToolsSection";
import { UsageStatsSection } from "./sections/UsageStatsSection";
import { UserSettingsSection } from "./sections/UserSettingsSection";

interface TabOption {
  id: string;
  label: string;
  component: React.ReactNode;
  icon: React.ReactNode;
}

interface TabSection {
  id: string;
  tabs: TabOption[];
  showTopDivider?: boolean;
  showBottomDivider?: boolean;
  className?: string;
}

export const topTabSections: TabSection[] = [
  {
    id: "top",
    tabs: [
      {
        id: "back",
        label: "sidebar.back",
        component: <div />,
        icon: <ArrowLeftIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
    ],
  },
  {
    id: "blocks",
    showTopDivider: true,
    tabs: [
      {
        id: "models",
        label: "sidebar.models",
        component: (
          <ConfigSection>
            <ModelsSection />
          </ConfigSection>
        ),
        icon: <CubeIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
      {
        id: "rules",
        label: "sidebar.rules",
        component: (
          <ConfigSection>
            <RulesSection />
          </ConfigSection>
        ),
        icon: <PencilIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
      {
        id: "tools",
        label: "sidebar.tools",
        component: (
          <ConfigSection>
            <ToolsSection />
          </ConfigSection>
        ),
        icon: (
          <WrenchScrewdriverIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
        ),
      },
      {
        id: "mcp",
        label: "sidebar.mcp",
        component: (
          <ConfigSection>
            <McpSection />
          </ConfigSection>
        ),
        icon: (
          <ServerStackIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
        ),
      },
      {
        id: "skills",
        label: "sidebar.skills",
        component: (
          <ConfigSection>
            <SkillsSection />
          </ConfigSection>
        ),
        icon: (
          <AcademicCapIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
        ),
      },
    ],
  },
  {
    id: "agents-orgs",
    showTopDivider: true,
    tabs: [
      {
        id: "configs",
        label: "sidebar.configs",
        component: (
          <ConfigSection>
            <ConfigsSection />
          </ConfigSection>
        ),
        icon: <DocumentIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
    ],
  },
  {
    id: "indexing",
    showTopDivider: true,
    tabs: [
      {
        id: "indexing",
        label: "sidebar.indexing",
        component: (
          <ConfigSection>
            <IndexingSettingsSection />
          </ConfigSection>
        ),
        icon: (
          <CircleStackIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
        ),
      },
      {
        id: "usage",
        label: "sidebar.usage",
        component: (
          <ConfigSection>
            <UsageStatsSection />
          </ConfigSection>
        ),
        icon: <ChartBarIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
      {
        id: "rtk",
        label: "sidebar.rtk",
        component: (
          <ConfigSection>
            <RtkSection />
          </ConfigSection>
        ),
        icon: <BoltIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
    ],
  },
];

export const bottomTabSections: TabSection[] = [
  {
    id: "bottom",
    tabs: [
      {
        id: "settings",
        label: "sidebar.settings",
        component: (
          <ConfigSection>
            <UserSettingsSection />
          </ConfigSection>
        ),
        icon: <Cog6ToothIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
      {
        id: "help",
        label: "sidebar.help",
        component: (
          <ConfigSection>
            <HelpSection />
          </ConfigSection>
        ),
        icon: (
          <QuestionMarkCircleIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
        ),
      },
    ],
  },
];

export const getAllTabs = (): TabOption[] => {
  return [...topTabSections, ...bottomTabSections].flatMap(
    (section) => section.tabs,
  );
};
