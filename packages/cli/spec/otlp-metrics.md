# OTLP metrics

`src/telemetry/telemetryService.ts` is the source of truth for what this CLI exports.
This page describes the instruments the service creates and the environment variables
that control export. The instruments and defaults below are the ones the service registers today.

## Enablement

`CONTINUE_METRICS_ENABLED` wins when set: `0` disables telemetry, `1` enables it. When
it is unset, `CONTINUE_CLI_ENABLE_TELEMETRY=1` enables telemetry. When neither is set,
telemetry is off.

## Export

- `OTEL_METRICS_EXPORTER` selects the exporter; the default is `console`, and `otlp`
  builds an `OTLPMetricExporter`.
- The OTLP endpoint is `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, falling back to
  `OTEL_EXPORTER_OTLP_ENDPOINT`.
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

- `OTEL_METRICS_INCLUDE_VERSION=true` adds the CLI version attribute; it is off by
  default.
- `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` defaults to on; set it to `false` to omit the
  account UUID.
- `os.type` is attached as a resource attribute.

## Logs and events

`logUserPrompt` redacts prompt content unless `OTEL_LOG_USER_PROMPTS=1`. OTLP log export
is not implemented - the service still carries `TODO: Implement OTLP logs export` - so
events are not shipped to a collector.

## Privacy

Prompt content is redacted by default, the account UUID can be omitted, and telemetry
can be disabled entirely with `CONTINUE_METRICS_ENABLED=0`.
