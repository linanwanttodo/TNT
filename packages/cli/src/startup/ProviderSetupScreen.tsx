/* eslint-disable max-statements -- one wizard owns the ordered input state machine */
import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useRef, useState } from "react";

import { startBrowserLogin } from "../config/openrouterLogin.js";
import {
  fetchModelIds,
  getDefaultModel,
  normalizeApiBase,
  PROTOCOLS,
  type ProviderSetup,
} from "../config/providerSetup.js";
import { t } from "../i18n/index.js";
import { splitTrailingEnter } from "../utils/coalescedEnter.js";

/**
 * Onboarding renders before the theme provider exists, so it borrows the
 * default palette. The value is the default theme's accent; keeping a copy
 * here avoids a startup -> ui import cycle for one colour.
 */
const ACCENT = "#5ac8fa";

type Step = "protocol" | "baseUrl" | "apiKey" | "model";

interface ProviderSetupScreenProps {
  onComplete: (setup: ProviderSetup) => void;
  onCancel: () => void;
  /**
   * True when this screen owns its Ink app (first-run onboarding). Embedded in
   * the main TUI it must unmount through navigation instead, so `exit()` -
   * which tears down whichever app is mounted - is skipped.
   */
  standalone?: boolean;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const ProviderSetupScreen: React.FC<ProviderSetupScreenProps> = ({
  onComplete,
  onCancel,
  standalone = true,
}) => {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("protocol");
  // No preselection: the protocol is a decision the user must make.
  const [protocolIndex, setProtocolIndex] = useState<number | null>(null);
  const [protocol, setProtocol] = useState(PROTOCOLS[0]);
  // Defaults are placeholders, not buffer contents: typing must replace them
  // rather than append to a URL the user did not ask for.
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [, setModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [browserLogin, setBrowserLogin] = useState<{
    pending: boolean;
    url?: string;
    error?: string;
  }>({ pending: false });
  // Ink can deliver a typed run as several data events before React commits a
  // state update. The ref accumulates across those events; state is only for
  // painting. Without it, a slow runner keeps only the last chunk.
  const fieldsRef = useRef({ baseUrl: "", apiKey: "", model: "" });

  useEffect(() => {
    if (step !== "model" || !apiKey || !baseUrl) return;
    if (!protocol.modelsPath) return;
    const controller = new AbortController();
    const load = async () => {
      setLoadingModels(true);
      try {
        const ids = await fetchModelIds({
          apiBase: baseUrl,
          apiKey,
          modelsPath: protocol.modelsPath,
          signal: controller.signal,
        });
        if (ids.length === 0) return;
        setAvailableModels(ids);
        setModelIndex(0);
      } catch {
        // Model entry remains available for providers that omit /models.
      } finally {
        setLoadingModels(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [step, apiKey, baseUrl, protocol.id]);

  const finish = (setup: ProviderSetup) => {
    onComplete(setup);
    if (standalone) exit();
  };

  const cancel = () => {
    onCancel();
    if (standalone) exit();
  };

  /**
   * The browser sign-in for a vendor whose key comes from a login. The URL is
   * printed as well as opened, so a machine without a browser still gets it.
   * A second Enter while the first login is still waiting must not open a
   * second callback server and a second browser tab.
   */
  const browserLoginPending = useRef(false);
  const beginBrowserLogin = async () => {
    if (browserLoginPending.current) return;
    browserLoginPending.current = true;
    setBrowserLogin({ pending: true });
    try {
      const result = await startBrowserLogin();
      setBrowserLogin({ pending: false, url: result.url, error: result.error });
      if (result.key) {
        setValueFor("apiKey", result.key);
        setError(undefined);
        setStep("model");
      }
    } catch (error) {
      setBrowserLogin({
        pending: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      browserLoginPending.current = false;
    }
  };

  const isField = (current: Step): current is "baseUrl" | "apiKey" | "model" =>
    current !== "protocol";

  const valueFor = (current: Step): string =>
    isField(current) ? fieldsRef.current[current] : "";

  const setValueFor = (current: Step, value: string) => {
    if (isField(current)) {
      fieldsRef.current = { ...fieldsRef.current, [current]: value };
    }
    if (current === "baseUrl") setBaseUrl(value);
    else if (current === "apiKey") setApiKey(value);
    else if (current === "model") setModel(value);
    setError(undefined);
  };

  const submit = (current: Step, value = valueFor(current)) => {
    if (current === "baseUrl") {
      const raw = value.trim() || protocol.defaultApiBase;
      const normalized = normalizeApiBase(protocol.id, raw);
      if (!isHttpUrl(normalized)) {
        setError(t("setup.invalidBaseUrl"));
        return;
      }
      setValueFor("baseUrl", normalized);
      setValueFor("model", "");
      setError(undefined);
      setStep("apiKey");
      return;
    }

    if (current === "apiKey") {
      const trimmed = value.trim();
      if (!trimmed) {
        if (protocol.browserLogin) {
          void beginBrowserLogin();
          return;
        }
        setError(t("setup.apiKeyRequired"));
        return;
      }
      setValueFor("apiKey", trimmed);
      setError(undefined);
      setStep("model");
      return;
    }

    if (current === "model") {
      const selected =
        value.trim() || getDefaultModel(protocol.id, valueFor("baseUrl"));
      if (!selected) {
        setError(t("setup.modelRequired"));
        return;
      }
      finish({
        protocol: protocol.id,
        apiBase: valueFor("baseUrl"),
        apiKey: valueFor("apiKey"),
        model: selected,
      });
    }
  };

  useInput((input, key) => {
    // The terminal can deliver the typed run and the Enter together, and some
    // send Enter as a bare "\n": both must act as Enter, or setup looks hung.
    const coalesced = key.shift ? null : splitTrailingEnter(input);
    const typed = coalesced?.body ?? input;
    const enter = key.return || coalesced !== null;

    if (key.escape) {
      cancel();
      return;
    }

    if (step === "protocol") {
      // A digit chooses; the same read can carry the Enter that confirms it.
      let chosen = protocolIndex;
      if (/^[1-9]$/.test(typed)) {
        const index = Number.parseInt(typed, 10) - 1;
        if (index < PROTOCOLS.length) {
          chosen = index;
          setProtocolIndex(index);
          setError(undefined);
        }
        if (!enter) {
          return;
        }
      } else if (key.upArrow) {
        setProtocolIndex((index) =>
          index === null ? PROTOCOLS.length - 1 : Math.max(0, index - 1),
        );
        return;
      } else if (key.downArrow) {
        setProtocolIndex((index) =>
          index === null ? 0 : Math.min(PROTOCOLS.length - 1, index + 1),
        );
        return;
      }

      if (enter) {
        if (chosen === null) {
          setError(t("setup.protocolRequired"));
          return;
        }
        const selected = PROTOCOLS[chosen];
        setProtocol(selected);
        // The URL is a fixed value for a vendor preset, so it starts filled in
        // rather than as a grey hint the reader has to recognise. Pressing
        // Enter accepts it; editing it still points the setup at a gateway.
        setValueFor("baseUrl", selected.defaultApiBase);
        setValueFor("model", "");
        setError(undefined);
        setStep("baseUrl");
      }
      return;
    }

    if (step === "model" && availableModels.length > 0) {
      if (key.upArrow) {
        setModelIndex((index) =>
          index <= 0 ? availableModels.length - 1 : index - 1,
        );
        return;
      }
      if (key.downArrow) {
        setModelIndex((index) => (index + 1) % availableModels.length);
        return;
      }
      if (enter && !valueFor("model").trim()) {
        submit("model", availableModels[modelIndex]);
        return;
      }
    }

    if (key.ctrl && input === "u") {
      setValueFor(step, "");
      return;
    }

    if (key.backspace || key.delete) {
      setValueFor(step, valueFor(step).slice(0, -1));
      return;
    }

    const printable = typed.replace(/[\u0000-\u001f\u007f]/g, "");
    const nextValue = valueFor(step) + printable;
    if (printable) {
      setValueFor(step, nextValue);
    }

    if (enter) {
      submit(step, nextValue);
    }
  });

  const description = (() => {
    switch (step) {
      case "baseUrl":
        return t("setup.baseUrlPrompt");
      case "apiKey":
        return t("setup.apiKeyPrompt");
      case "model":
        return t("setup.modelPrompt");
      default:
        return t("setup.selectProtocol");
    }
  })();

  const label = (() => {
    switch (step) {
      case "baseUrl":
        return t("setup.baseUrl");
      case "apiKey":
        return t("setup.apiKey");
      case "model":
        return t("setup.model");
      default:
        return t("setup.protocol");
    }
  })();

  const currentValue = valueFor(step);
  const shownValue =
    step === "apiKey" ? "*".repeat(currentValue.length) : currentValue;
  const placeholder =
    step === "baseUrl"
      ? protocol.defaultApiBase || protocol.exampleApiBase
      : step === "model"
        ? getDefaultModel(protocol.id, baseUrl) ||
          protocol.defaultModel ||
          protocol.exampleModel
        : undefined;

  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>{t("setup.title")}</Text>
      <Box marginTop={1}>
        <Text>{description}</Text>
      </Box>

      {step === "protocol" ? (
        <Box marginTop={1} flexDirection="column">
          {PROTOCOLS.map((option, index) => {
            const selected = index === protocolIndex;
            return (
              <Text key={option.id} color={selected ? ACCENT : "white"}>
                {selected ? "❯ " : "  "}
                {`${index + 1}) `}
                {option.label}
                {option.defaultApiBase ? (
                  <Text color="gray">{`  ${option.defaultApiBase}`}</Text>
                ) : option.exampleApiBase ? (
                  <Text color="gray">{`  e.g. ${option.exampleApiBase}`}</Text>
                ) : null}
              </Text>
            );
          })}
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{label}</Text>
          <Box
            borderStyle="round"
            borderColor={ACCENT}
            paddingX={1}
            marginTop={0}
          >
            {currentValue ? (
              <Text>
                {shownValue}
                <Text color={ACCENT}>▋</Text>
              </Text>
            ) : (
              <Text>
                <Text color="gray">{placeholder ?? ""}</Text>
                <Text color={ACCENT}>▋</Text>
              </Text>
            )}
          </Box>
        </Box>
      )}

      {step === "model" && (loadingModels || availableModels.length > 0) ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">
            {loadingModels
              ? "正在获取模型…"
              : `模型 (${availableModels.length})`}
          </Text>
          {availableModels.slice(0, 8).map((id, index) => (
            <Text key={id} color={index === modelIndex ? ACCENT : "gray"}>
              {index === modelIndex ? "❯ " : "  "}
              {id}
            </Text>
          ))}
          {availableModels.length > 8 ? (
            <Text color="gray">其余模型可直接输入名称。</Text>
          ) : null}
        </Box>
      ) : null}

      {browserLogin.pending ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{t("setup.browserLoginWaiting")}</Text>
        </Box>
      ) : browserLogin.url ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{t("setup.browserLoginUrl")}</Text>
          <Text>{browserLogin.url}</Text>
        </Box>
      ) : null}

      {browserLogin.error ? (
        <Box marginTop={1}>
          <Text color="red">{browserLogin.error}</Text>
        </Box>
      ) : null}

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          {step === "protocol"
            ? t("setup.protocolInstructions")
            : t("setup.confirm")}
        </Text>
      </Box>
    </Box>
  );
};
