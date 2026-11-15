# Onboarding

Onboarding runs once per installation. `initializeWithOnboarding` is called from
`initializeServices` only when the run is not headless and `skipOnboarding` is false, so
`-p` and `serve` never enter it (`src/services/index.ts`).

## First-run check

Completion is recorded by `~/.tnt/.onboarding_complete` - `isFirstTime` checks for the
file and `markOnboardingComplete` writes an ISO timestamp into it. The marker is only
written when `runOnboardingFlow` returns true.

## When `--config` is given

The config is loaded and validated first; a failure throws
`startup.failedToLoadConfigFrom` with the path and the error. `runOnboardingFlow` then
returns false, so a supplied config neither runs the interactive setup nor marks
onboarding complete.

## `TNT_USE_BEDROCK=1`

Before any prompt, the flow prints the `setup.bedrock` message and returns true, so
onboarding is marked complete. AWS credentials must already be available through the
standard credential chain.

## Test, CI, and non-TTY runs

When `NODE_ENV=test`, `CI=true`, `VITEST=true`, `GITHUB_ACTIONS=true`, or stdin is not a
TTY, no prompt runs. If `ANTHROPIC_API_KEY` is set the flow prints
`startup.anthropicKey`; either way it returns false and does not write the marker.

## Interactive runs

On a real terminal, `runProviderSetupInk()` renders one bordered
`ProviderSetupScreen`: a numbered protocol list (Up/Down or a number key, Enter), then
the base URL, API key and model in the same box, one field at a time. No protocol is
preselected; Enter on the list asks for a choice instead of accepting a default. Enter
confirms a field, Esc cancels, and the API key is masked while it is typed.

When stdout is not a TTY, `runProviderSetup()` asks for the same fields with line
prompts. Both paths return the same `ProviderSetup`; `writeConfig()` writes the
resulting configuration and the flow prints `setup.saved` with the path. No
login or hosted assistant is required.

## Source

- `src/startup/onboarding.ts` - the flow, first-run check and marker
- `src/config/providerSetup.ts` - protocols, defaults and config writing
- `src/startup/ProviderSetupScreen.tsx` - the single-box Ink setup screen
- `src/services/index.ts` - when onboarding is invoked
