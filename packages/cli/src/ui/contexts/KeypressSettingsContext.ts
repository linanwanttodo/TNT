import { createContext, useContext } from "react";

/**
 * Minimal settings surface for the ported gemini-cli text buffer. TNT has no
 * gemini settings store; the buffer only reads two general flags, which stay
 * off.
 */
interface KeypressSettings {
  merged: {
    general: {
      debugKeystrokeLogging: boolean;
      openEditorInNewWindow: boolean;
    };
  };
}

const defaultSettings: KeypressSettings = {
  merged: {
    general: {
      debugKeystrokeLogging: false,
      openEditorInNewWindow: false,
    },
  },
};

const SettingsContext = createContext<KeypressSettings>(defaultSettings);

export const KeypressSettingsProvider = SettingsContext.Provider;

export function useSettings(): KeypressSettings {
  return useContext(SettingsContext);
}
