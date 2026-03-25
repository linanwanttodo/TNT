# OTLP metrics

`src/telemetry/telemetryService.ts` is the source of truth for what this CLI exports.
This page describes the instruments the service creates and the environment variables
that control export. The instruments and defaults below are the ones the service registers today.

## Enablement

`TNT_METRICS_ENABLED` wins when set: `0` disables telemetry, `1` enables it. When
it is unset, `TNT_ENABLE_TELEMETRY=1` enables telemetry. When neither is set,
telemetry is off.

The switch alone does not start anything. Telemetry is only on when it is enabled **and**
at least one of `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` or
`OTEL_METRICS_EXPORTER` is set.

## Export

- `OTEL_METRICS_EXPORTER` selects the exporters, comma-separated; `otlp` builds an
  `OTLPMetricExporter` and `console` a `ConsoleMetricExporter`; the default is `console`,
  and an unrecognized name is ignored.
- The OTLP URL is `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`; when it is absent,
  `OTEL_EXPORTER_OTLP_ENDPOINT` is used with `/v1/metrics` appended. With neither,
  the exporter posts to `http://localhost:4318/v1/metrics`.
- `OTEL_EXPORTER_OTLP_HEADERS` supplies exporter headers.
- `OTEL_METRIC_EXPORT_INTERVAL` sets the export interval in milliseconds; the default
  is 20000.

## Instruments

Counters:

- `continue_cli_session_count`
- `continue_cli_lines_of_code_count`
- `continue_cli_pull_request_count`
- `continue_cli_commit_count`
- `continue_cli_cost_usage`
- `continue_cli_token_usage`
- `continue_cli_code_edit_tool_decision`
- `continue_cli_active_time_total`
- `continue_cli_auth_attempts`
- `continue_cli_slash_command_usage`

Histograms:

- `continue_cli_startup_time`
- `continue_cli_response_time`

Observable gauge:

- `continue_cli_mcp_connections`

## Attributes

- `OTEL_METRICS_INCLUDE_VERSION=true` adds `app.version`; it is off by default.
- `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` defaults to on; set it to `false` to omit the
  account UUID.
- `ORGANIZATION_ID` adds `organization.id`, and the detected terminal type adds
  `terminal.type`.
- The resource carries `service.name`, `service.version`, `host.name`,
  `deployment.environment`, and `os.type`.

## Logs and events

`logUserPrompt` redacts prompt content unless `OTEL_LOG_USER_PROMPTS=1`. OTLP log export
is not implemented - the service still carries `TODO: Implement OTLP logs export` - so
events are not shipped to a collector.

## Privacy

Prompt content is redacted by default, the account UUID can be omitted, and telemetry
can be disabled entirely with `TNT_METRICS_ENABLED=0`.
