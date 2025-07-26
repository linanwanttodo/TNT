import {
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleStackIcon,
  DocumentPlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  PaperClipIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import { InputModifiers, MessageModes } from "core";
import { modelSupportsImages } from "core/llm/autodetect";
import { memo, useCallback, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { useAppDispatch, useAppSelector } from "../../redux/hooks.ts";
import { selectUseActiveFile } from "../../redux/selectors/index.ts";
import { selectSelectedChatModel } from "../../redux/slices/configSlice.ts";
import { setMode } from "../../redux/slices/sessionSlice.ts";
import { isMetaEquivalentKeyPressed } from "../../util/index.ts";
import { resolveModes } from "../../util/modes.ts";
import { CONFIG_ROUTES } from "../../util/navigation.ts";
import { ToolTip } from "../gui/Tooltip.tsx";
import ModelSelect from "../modelSelection/ModelSelect.tsx";
import { ModeIcon } from "../ModeSelect/ModeIcon.tsx";
import { ModeSelect } from "../ModeSelect/ModeSelect.tsx";
import { Popover, PopoverButton, PopoverPanel } from "../ui/index.ts";
import ContextUsage from "./ContextUsage.tsx";
import type { ToolbarOptions } from "./InputToolbar.tsx";
import { useMainEditor } from "./TipTapEditor/MainEditorProvider.tsx";

interface ComposerBarProps {
  onEnter?: (modifiers: InputModifiers) => void;
  onAddContextItem?: (prefix?: string) => void;
  onImageFileSelected?: (file: File) => void;
  hidden?: boolean;
  toolbarOptions?: ToolbarOptions;
  disabled?: boolean;
  isMainInput?: boolean;
}

interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  description?: string;
  selected?: boolean;
  hasSubmenu?: boolean;
  onSelect: () => void;
}

function MenuRow(props: MenuRowProps) {
  return (
    <button
      type="button"
      className="composer-menu-item"
      onClick={props.onSelect}
    >
      <span className="composer-menu-item-icon">{props.icon}</span>
      <span className="composer-menu-item-body">
        <span className="composer-menu-item-label">{props.label}</span>
        {props.description && (
          <span className="composer-menu-item-desc">{props.description}</span>
        )}
      </span>
      {props.selected && (
        <CheckIcon className="composer-menu-item-check h-3.5 w-3.5" />
      )}
      {props.hasSubmenu && (
        <ChevronRightIcon
          className="composer-menu-item-chevron h-3 w-3"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

function ComposerBar(props: ComposerBarProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const defaultModel = useAppSelector(selectSelectedChatModel);
  const useActiveFile = useAppSelector(selectUseActiveFile);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const mode = useAppSelector((store) => store.session.mode);
  const mcpServers = useAppSelector(
    (store) => store.config.config.mcpServerStatuses,
  );
  const { mainEditor } = useMainEditor();

  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const supportsImages =
    defaultModel &&
    modelSupportsImages(
      defaultModel.provider,
      defaultModel.model,
      defaultModel.title,
      defaultModel.capabilities,
    );

  const showImageUpload =
    !props.toolbarOptions?.hideImageUpload && Boolean(supportsImages);
  const showAddContext = !props.toolbarOptions?.hideAddContext;

  const submit = (modifierPressed: boolean) => {
    props.onEnter?.({
      useCodebase: false,
      noContext: useActiveFile ? modifierPressed : !modifierPressed,
    });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matches = useCallback(
    (label: string, description?: string) =>
      normalizedQuery.length === 0 ||
      label.toLowerCase().includes(normalizedQuery) ||
      (description?.toLowerCase().includes(normalizedQuery) ?? false),
    [normalizedQuery],
  );

  // The active mode is left out of the list: it is already in effect, and
  // picking it again would be a no-op. Switching to it means picking one of
  // the others.
  const modeEntries = resolveModes(t).filter(
    (entry) => entry.id !== mode && matches(entry.label, entry.description),
  );

  const connectorEntries = mcpServers.filter((server) => matches(server.name));

  const fileEntries = [
    showAddContext && {
      key: "file",
      label: t("composer.addMenu.files.file"),
      icon: <DocumentPlusIcon className="h-3.5 w-3.5" />,
      onClick: () => props.onAddContextItem?.("@"),
    },
    showAddContext && {
      key: "folder",
      label: t("composer.addMenu.files.folder"),
      icon: <FolderPlusIcon className="h-3.5 w-3.5" />,
      onClick: () => props.onAddContextItem?.("@folder"),
    },
    showImageUpload && {
      key: "image",
      label: t("composer.addMenu.files.image"),
      icon: <PhotoIcon className="h-3.5 w-3.5" />,
      onClick: () => fileInputRef.current?.click(),
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
  }[];

  // A row stays visible when its own label matches, or when it still has
  // matching entries under it.
  const visibleFileEntries = fileEntries.filter((entry) =>
    matches(entry.label),
  );
  const filesLabel = t("composer.addMenu.files");
  const mcpLabel = t("composer.addMenu.mcp");

  const showFilesRow =
    fileEntries.length > 0 &&
    (matches(filesLabel) || visibleFileEntries.length > 0);
  const showModeRow = !isInEdit && modeEntries.length > 0;
  const showConnectorRow =
    mcpServers.length > 0 && (matches(mcpLabel) || connectorEntries.length > 0);

  const hasMatches = showFilesRow || showModeRow || showConnectorRow;

  return (
    <div
      className={`composer-bar flex select-none flex-row items-center ${
        props.hidden ? "pointer-events-none opacity-0" : "pointer-events-auto"
      }`}
    >
      <div
        className="composer-control-group"
        data-testid="composer-control-group"
      >
        <Popover className="relative flex-shrink-0">
          {({ open, close }) => {
            if (!open && activeSubmenu !== null) {
              queueMicrotask(() => setActiveSubmenu(null));
            }
            return (
              <>
                <ToolTip place="top" content={t("composer.addMenu.files")}>
                  <PopoverButton
                    type="button"
                    aria-label={t("composer.addMenu.files")}
                    data-testid="composer-add-button"
                    className="composer-icon-button"
                  >
                    <PaperClipIcon
                      className="h-4 w-4"
                      data-testid="composer-attachment-icon"
                    />
                  </PopoverButton>
                </ToolTip>
                <PopoverPanel
                  anchor="top start"
                  className="composer-menu composer-menu-root z-50"
                  onMouseLeave={() => setActiveSubmenu(null)}
                >
                  <div className="composer-menu-search">
                    <MagnifyingGlassIcon className="h-3.5 w-3.5" />
                    <input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActiveSubmenu(null);
                      }}
                      placeholder={t("composer.addMenu.search")}
                      className="composer-menu-search-input"
                    />
                  </div>

                  {modeEntries.map(({ id, label, description }) => (
                    <MenuRow
                      key={id}
                      icon={<ModeIcon mode={id} className="h-3.5 w-3.5" />}
                      label={label}
                      description={description}
                      onSelect={() => {
                        dispatch(setMode(id));
                        close();
                        mainEditor?.commands.focus();
                      }}
                    />
                  ))}

                  {showModeRow && (showFilesRow || showConnectorRow) && (
                    <div className="composer-menu-divider" />
                  )}

                  {showFilesRow && (
                    <SubMenu
                      icon={<PaperClipIcon className="h-3.5 w-3.5" />}
                      label={t("composer.addMenu.files")}
                      open={activeSubmenu === "files"}
                      onOpen={() => setActiveSubmenu("files")}
                      entries={visibleFileEntries}
                      emptyLabel={t("composer.addMenu.empty")}
                      onSelect={() => close()}
                    />
                  )}

                  {showConnectorRow && (
                    <SubMenu
                      icon={<CircleStackIcon className="h-3.5 w-3.5" />}
                      label={t("composer.addMenu.mcp")}
                      open={activeSubmenu === "connectors"}
                      onOpen={() => setActiveSubmenu("connectors")}
                      entries={connectorEntries.map((server) => ({
                        key: server.id,
                        label: server.name,
                        selected: server.status !== "disabled",
                        icon: <CircleStackIcon className="h-3.5 w-3.5" />,
                        onClick: () => {
                          void ideMessenger.request("mcp/setServerEnabled", {
                            id: server.id,
                            enabled: server.status === "disabled",
                          });
                        },
                      }))}
                      emptyLabel={t("composer.addMenu.mcp.empty")}
                      footer={{
                        label: t("composer.addMenu.mcp.manage"),
                        onClick: () => navigate(CONFIG_ROUTES.MCP),
                      }}
                      onSelect={() => close()}
                    />
                  )}

                  {!hasMatches && (
                    <div className="composer-menu-empty">
                      {t("composer.addMenu.empty")}
                    </div>
                  )}
                </PopoverPanel>
              </>
            );
          }}
        </Popover>
        {!isInEdit && (
          <ModeSelect enableCycleShortcut={props.isMainInput === true} />
        )}
        {!props.toolbarOptions?.hideSelectModel && (
          <div className="composer-model-select">
            <ModelSelect />
          </div>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
        onChange={(e) => {
          const files = e.target?.files ?? [];
          for (const file of files) {
            props.onImageFileSelected?.(file);
          }
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
      />

      <div className="composer-actions">
        <ContextUsage />

        <ToolTip
          place="top"
          content={
            isInEdit
              ? (props.toolbarOptions?.enterText ?? t("composer.send"))
              : t("composer.send")
          }
        >
          <button
            type="button"
            data-testid="submit-input-button"
            aria-label={t("composer.send")}
            className="composer-send-button"
            disabled={props.disabled}
            onClick={(e) =>
              submit(isMetaEquivalentKeyPressed(e as any) || e.altKey)
            }
          >
            <ArrowUpIcon className="h-4 w-4" />
          </button>
        </ToolTip>
      </div>
    </div>
  );
}

interface SubMenuEntry {
  key: string;
  label: string;
  icon?: React.ReactNode;
  selected?: boolean;
  onClick: () => void;
}

interface SubMenuProps {
  icon: React.ReactNode;
  label: string;
  entries: SubMenuEntry[];
  open: boolean;
  onOpen: () => void;
  emptyLabel: string;
  footer?: { label: string; onClick: () => void };
  onSelect: () => void;
}

function SubMenu(props: SubMenuProps) {
  return (
    <div className="relative" onMouseEnter={props.onOpen}>
      <MenuRow
        icon={props.icon}
        label={props.label}
        hasSubmenu
        onSelect={props.onOpen}
      />
      {props.open && (
        <div className="composer-menu composer-submenu absolute left-full top-0 z-50 ml-1">
          {props.entries.length > 0 ? (
            props.entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="composer-menu-item"
                onClick={() => {
                  entry.onClick();
                  props.onSelect();
                }}
              >
                <span className="composer-menu-item-icon">
                  {entry.selected ? (
                    <CheckIcon className="h-3.5 w-3.5" />
                  ) : (
                    entry.icon
                  )}
                </span>
                <span className="composer-menu-item-body">
                  <span className="composer-menu-item-label">
                    {entry.label}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="composer-menu-empty">{props.emptyLabel}</div>
          )}
          {props.footer && (
            <>
              <div className="composer-menu-divider" />
              <button
                type="button"
                className="composer-menu-item"
                onClick={() => {
                  props.footer?.onClick();
                  props.onSelect();
                }}
              >
                <span className="composer-menu-item-body">
                  <span className="composer-menu-item-label">
                    {props.footer.label}
                  </span>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ComposerBar);
