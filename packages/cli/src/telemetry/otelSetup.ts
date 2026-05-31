import os from "os";

import type { MeterProvider } from "@opentelemetry/sdk-metrics";

import { getVersion } from "../startup/version.js";

import { parseOtelHeaders } from "./headerUtils.js";

export interface MeterProviderSetup {
  meterProvider: MeterProvider;
  /** The exporter kinds the environment asked for, for the init log line. */
  exporters: string[];
}

/**
 * Build the metrics pipeline: the resource attributes, the exporter readers the
 * environment names, and the provider over them.
 *
 * The SDK and the OTLP exporter are several hundred kilobytes that only matter
 * when an endpoint is configured, so every one of them is imported here at call
 * time - the shipped CLI's eager startup closure has a byte ceiling the guard
 * tests enforce, and a top-level import of the exporter blows through it.
 */
export async function createMeterProvider(
  serviceName: string,
): Promise<MeterProviderSetup> {
  const [
    { OTLPMetricExporter },
    { resourceFromAttributes },
    sdkMetrics,
    semanticConventions,
  ] = await Promise.all([
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/semantic-conventions"),
  ]);
  const {
    ConsoleMetricExporter,
    MeterProvider,
    PeriodicExportingMetricReader,
  } = sdkMetrics;
  const {
    SEMRESATTRS_SERVICE_NAME,
    SEMRESATTRS_SERVICE_VERSION,
    SEMRESATTRS_HOST_NAME,
    SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
    SEMRESATTRS_OS_TYPE,
  } = semanticConventions;

  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: getVersion(),
    [SEMRESATTRS_HOST_NAME]: os.hostname(),
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || "development",
    [SEMRESATTRS_OS_TYPE]: os.type(),
  });

  const readers: any[] = [];
  const exporters = (process.env.OTEL_METRICS_EXPORTER || "console").split(",");
  const exportIntervalMillis = parseInt(
    process.env.OTEL_METRIC_EXPORT_INTERVAL || "20000",
  );

  for (const exporterType of exporters) {
    switch (exporterType.trim()) {
      case "otlp":
        readers.push(
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: otlpMetricsUrl(),
              headers: parseOtelHeaders(
                process.env.OTEL_EXPORTER_OTLP_HEADERS || "",
              ),
            }),
            exportIntervalMillis,
          }),
        );
        break;
      case "console":
        readers.push(
          new PeriodicExportingMetricReader({
            exporter: new ConsoleMetricExporter(),
            exportIntervalMillis,
          }),
        );
        break;
    }
  }

  return {
    meterProvider: new MeterProvider({ resource, readers }),
    exporters,
  };
}

/** The metrics endpoint, from the metrics-specific or the base OTLP variable. */
function otlpMetricsUrl(): string {
  const metricsEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  if (metricsEndpoint && metricsEndpoint.trim().length > 0) {
    return metricsEndpoint;
  }
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base && base.trim().length > 0) {
    const normalized = base.replace(/\/$/, "");
    return `${normalized}/v1/metrics`;
  }
  return "http://localhost:4318/v1/metrics";
}
