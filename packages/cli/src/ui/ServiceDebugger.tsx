import { Box, Text } from "ink";
import React from "react";

import { t } from "../i18n/index.js";
import {
  ApiClientServiceState,
  ConfigServiceState,
  MCPServiceState,
  ModelServiceState,
} from "../services/types.js";

import { defaultBoxStyles } from "./styles.js";
import { symbols } from "./symbols.js";

interface ServiceDebuggerProps {
  services: {
    config?: ConfigServiceState;
    model?: ModelServiceState;
    mcp?: MCPServiceState;
    apiClient?: ApiClientServiceState;
  };
  loading: boolean;
  error: any;
  allReady: boolean;
  servicesLoading: boolean;
  servicesError: any;
}

const ServiceDebugger: React.FC<ServiceDebuggerProps> = ({
  services,
  loading,
  error,
  allReady,
  servicesLoading,
  servicesError,
}) => {
  const getServiceStatus = (serviceName: string, service: any) => {
    if (!service) return "x Not loaded";
    if (service.error) return `x Error: ${service.error}`;
    return `${symbols().check} Ready`;
  };

  const getServiceDetails = (serviceName: string, service: any) => {
    switch (serviceName) {
      case "config":
        return service?.config
          ? `Config: ${service.config.name}`
          : t("debug.noConfig");
      case "model":
        return service?.model
          ? `Model: ${service.model.name}`
          : t("debug.noModel");
      case "mcp":
        return service?.mcpService
          ? `Tools: ${service.mcpService.getTools()?.length || 0}`
          : t("debug.noMcp");
      case "apiClient":
        return service?.apiClient ? t("debug.apiReady") : t("debug.noApi");
      default:
        return "";
    }
  };

  return (
    <Box {...defaultBoxStyles("cyan")}>
      <Text bold color="cyan">
        🔧 Service Debug Info
      </Text>
      <Text> </Text>

      <Text color="yellow">{t("debug.overallStatus")}</Text>
      <Text>Loading: {loading ? "~ Yes" : `${symbols().check} No`}</Text>
      <Text>All Ready: {allReady ? `${symbols().check} Yes` : "x No"}</Text>
      <Text>
        Services Loading: {servicesLoading ? "~ Yes" : `${symbols().check} No`}
      </Text>

      {error && <Text color="red">Error: {String(error)}</Text>}

      {servicesError && (
        <Text color="red">Services Error: {String(servicesError)}</Text>
      )}

      <Text> </Text>
      <Text color="yellow">{t("debug.individualServices")}</Text>

      {["config", "model", "mcp", "apiClient"].map((serviceName) => {
        const service = services[serviceName as keyof typeof services];
        const status = getServiceStatus(serviceName, service);
        const details = getServiceDetails(serviceName, service);

        return (
          <Box key={serviceName} flexDirection="column" marginLeft={2}>
            <Text>
              <Text color="white">{serviceName}:</Text> {status}
            </Text>
            {details && (
              <Box marginLeft={2}>
                <Text color="gray">{details}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text color="yellow">{t("debug.introConditions")}</Text>
      <Text>Services ready: {allReady ? symbols().check : "x"}</Text>
      <Text>Has config: {services.config?.config ? symbols().check : "x"}</Text>
      <Text>Has model: {services.model?.model ? symbols().check : "x"}</Text>
      <Text>
        Has MCP service: {services.mcp?.mcpService ? symbols().check : "x"}
      </Text>

      <Text> </Text>
      <Text color="gray" italic>
        Comment out this component when debugging is complete
      </Text>
    </Box>
  );
};

export { ServiceDebugger };
