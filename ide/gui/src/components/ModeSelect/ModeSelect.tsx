import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { MessageModes } from "core";
import { useCallback, useEffect, useMemo } from "react";
import { useI18n } from "../../i18n/index.tsx";
import { useAppDispatch, useAppSelector } from "../../redux/hooks.ts";
import { setMode } from "../../redux/slices/sessionSlice.ts";
import { isMetaEquivalentKeyPressed } from "../../util/index.ts";
import { resolveModes } from "../../util/modes.ts";
import { useMainEditor } from "../mainInput/TipTapEditor/index.ts";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../ui/index.ts";
import { ModeIcon } from "./ModeIcon.tsx";

interface ModeSelectProps {
  enableCycleShortcut?: boolean;
}

export function ModeSelect({ enableCycleShortcut = false }: ModeSelectProps) {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((store) => store.session.mode);
  const { t } = useI18n();
  const modes = useMemo(() => resolveModes(t), [t]);
  const activeMode = modes.find((entry) => entry.id === mode);
  const { mainEditor } = useMainEditor();

  const cycleMode = useCallback(() => {
    const currentIndex = modes.findIndex((entry) => entry.id === mode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    if (!nextMode) {
      return;
    }
    dispatch(setMode(nextMode.id));
    if (!document.activeElement?.classList?.contains("ProseMirror")) {
      mainEditor?.commands.focus();
    }
  }, [dispatch, mode, mainEditor, modes]);

  const selectMode = useCallback(
    (newMode: MessageModes) => {
      if (newMode === mode) {
        return;
      }

      dispatch(setMode(newMode));

      mainEditor?.commands.focus();
    },
    [dispatch, mode, mainEditor],
  );

  useEffect(() => {
    if (!enableCycleShortcut) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "." && isMetaEquivalentKeyPressed(e)) {
        e.preventDefault();
        cycleMode();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cycleMode, enableCycleShortcut]);

  return (
    <Listbox value={mode} onChange={selectMode}>
      <div className="composer-mode-select relative">
        <ListboxButton
          data-testid="mode-select-button"
          aria-label={activeMode?.label ?? mode}
          className="composer-mode-select-button"
        >
          <ModeIcon mode={mode} />
          <span className="composer-mode-select-label">
            {activeMode?.label ?? mode}
          </span>
          <ChevronDownIcon
            className="h-3 w-3 flex-shrink-0"
            aria-hidden="true"
          />
        </ListboxButton>
        <ListboxOptions
          anchor="top start"
          portal
          className="composer-mode-menu"
        >
          {modes.map((entry) => (
            <ListboxOption
              key={entry.id}
              value={entry.id}
              className="composer-mode-option"
            >
              <ModeIcon mode={entry.id} className="h-3.5 w-3.5" />
              <span className="composer-mode-option-label">{entry.label}</span>
              {mode === entry.id && (
                <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
