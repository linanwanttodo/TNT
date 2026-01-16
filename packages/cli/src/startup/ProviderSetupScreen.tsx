import { Box, Text, useApp, useInput } from "ink";
import React, { useState } from "react";

import {
  getDefaultModel,
  normalizeApiBase,
  PROTOCOLS,
  type ProviderSetup,
} from "../config/providerSetup.js";
import { t } from "../i18n/index.js";

/** Matches the dark theme accent; onboarding renders before its provider. */
const ACCENT = "#5ac8fa";

type Step = "protocol" | "baseUrl" | "apiKey" | "model";

interface ProviderSetupScreenProps {
  onComplete: (setup: ProviderSetup) => void;
  onCancel: () => void;
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
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | undefined>();

  const finish = (setup: ProviderSetup) => {
    onComplete(setup);
    exit();
  };

  const cancel = () => {
    onCancel();
    exit();
  };

  const valueFor = (current: Step): string => {
    switch (current) {
      case "baseUrl":
        return baseUrl;
      case "apiKey":
        return apiKey;
      case "model":
        return model;
      default:
        return "";
    }
  };

  const setValueFor = (current: Step, value: string) => {
    if (current === "baseUrl") setBaseUrl(value);
    else if (current === "apiKey") setApiKey(value);
    else if (current === "model") setModel(value);
    setError(undefined);
  };

  const submit = (current: Step) => {
    if (current === "baseUrl") {
      const raw = baseUrl.trim() || protocol.defaultApiBase;
      const normalized = normalizeApiBase(protocol.id, raw);
      if (!isHttpUrl(normalized)) {
        setError(t("setup.invalidBaseUrl"));
        return;
      }
      setBaseUrl(normalized);
      setModel("");
      setError(undefined);
      setStep("apiKey");
      return;
    }

    if (current === "apiKey") {
      const value = apiKey.trim();
      if (!value) {
        setError(t("setup.apiKeyRequired"));
        return;
      }
      setApiKey(value);
      setError(undefined);
      setStep("model");
      return;
    }

    if (current === "model") {
      const value = model.trim() || getDefaultModel(protocol.id, baseUrl);
      if (!value) {
        setError(t("setup.modelRequired"));
        return;
      }
      finish({
        protocol: protocol.id,
        apiBase: baseUrl,
        apiKey,
        model: value,
      });
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      cancel();
      return;
    }

    if (step === "protocol") {
      if (/^[1-9]$/.test(input)) {
        const index = Number.parseInt(input, 10) - 1;
        if (index < PROTOCOLS.length) {
          setProtocolIndex(index);
          setError(undefined);
        }
        return;
      }

      if (key.upArrow) {
        setProtocolIndex((index) =>
          index === null ? PROTOCOLS.length - 1 : Math.max(0, index - 1),
        );
      } else if (key.downArrow) {
        setProtocolIndex((index) =>
          index === null ? 0 : Math.min(PROTOCOLS.length - 1, index + 1),
        );
      } else if (key.return) {
        if (protocolIndex === null) {
          setError(t("setup.protocolRequired"));
          return;
        }
        const selected = PROTOCOLS[protocolIndex];
        setProtocol(selected);
        setBaseUrl("");
        setModel("");
        setError(undefined);
        setStep("baseUrl");
      }
      return;
    }

    if (key.return) {
      submit(step);
      return;
    }

    if (key.ctrl && input === "u") {
      setValueFor(step, "");
      return;
    }

    if (key.backspace || key.delete) {
      setValueFor(step, valueFor(step).slice(0, -1));
      return;
    }

    const printable = input.replace(/[\u0000-\u001f\u007f]/g, "");
    if (printable) {
      setValueFor(step, valueFor(step) + printable);
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
