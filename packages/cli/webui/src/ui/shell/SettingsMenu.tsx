/**
 * The menu the account row opens: the permission modes the server supports,
 * then the read-only facts of the session it serves. Every option posts to
 * /permission-mode; the facts are display only.
 */
import { useEffect, useRef } from "react";

import {
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "../../api/client.ts";
import {
  IconCheckOutlineRegular,
  IconPlusOutlineRegular,
  IconSettingsOutlineRegular,
} from "../primitives/icons/index.tsx";
import css from "./SettingsMenu.module.css";

/** Props the settings menu renders from. */
export interface SettingsMenuProps {
  open: boolean;
  onClose: () => void;
  /** Mode the server currently reports; undefined until /state lands. */
  permissionMode: string | undefined;
  onSetPermissionMode: ((mode: PermissionMode) => void) | undefined;
  /** Permission modes belong at the composer; other menus hide them. */
  showPermissionModes?: boolean | undefined;
  /** Model label shown as a fact line. */
  model: string;
  /** Workspace directory shown as a fact line. */
  workspaceDirectory: string | null;
  /** Starts a fresh conversation; shown when the menu has an actions section. */
  onNewSession?: (() => void) | undefined;
  /** Extra class the anchor layout may add to reposition the popover. */
  className?: string | undefined;
}

/**
 * The account-row popover.
 * @param props - open state, the current mode and the session facts.
 * @returns the menu element, or null while closed.
 */
export function SettingsMenu({
  open,
  onClose,
  permissionMode,
  onSetPermissionMode,
  showPermissionModes = true,
  model,
  workspaceDirectory,
  onNewSession,
  className,
}: SettingsMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`${css.menu} ${className ?? ""}`} role="menu" ref={ref}>
      {onNewSession ? (
        <>
          <button
            type="button"
            role="menuitem"
            className={css.actionItem}
            onClick={() => {
              onNewSession();
              onClose();
            }}
          >
            <IconPlusOutlineRegular size={14} className={css.actionIcon} />
            New session
          </button>
          <div className={css.divider} />
        </>
      ) : null}
      {showPermissionModes ? (
        <>
          <div className={css.heading}>
            <IconSettingsOutlineRegular size={12} className={css.headingIcon} />
            Permission mode
          </div>
          {PERMISSION_MODE_OPTIONS.map((option) => {
            const selected = option.mode === permissionMode;
            return (
              <button
                type="button"
                key={option.mode}
                role="menuitemradio"
                aria-checked={selected}
                className={css.option}
                data-selected={selected}
                onClick={() => {
                  onSetPermissionMode?.(option.mode);
                  onClose();
                }}
              >
                <span className={css.optionLabel}>
                  {option.label}
                  {selected ? (
                    <IconCheckOutlineRegular
                      size={14}
                      className={css.optionCheck}
                    />
                  ) : null}
                </span>
                <span className={css.optionDesc}>{option.description}</span>
              </button>
            );
          })}
          <div className={css.divider} />
        </>
      ) : null}
      <div className={css.info} title={workspaceDirectory ?? undefined}>
        Workspace: {workspaceDirectory ?? "—"}
      </div>
      <div className={css.info}>Model: {model}</div>
    </div>
  );
}
