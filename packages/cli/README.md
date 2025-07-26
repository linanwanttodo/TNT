# TNT

TNT (`tnt`) is a customizable command line coding agent.

This project is a fork derived from [Continue](https://github.com/linanwanttodo/TNT), an open-source AI code agent. TNT builds on TNT's foundation with its own naming, CLI interface and behavior changes.

![TNT Demo](./media/demo.gif)

## Installation

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/linanwanttodo/TNT/main/packages/cli/scripts/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/linanwanttodo/TNT/main/packages/cli/scripts/install.ps1 | iex
```

Or install with npm if you have Node.js 20+:

```bash
npm i -g @tnt/cli
```

## Usage

```bash
tnt
```

### Headless Mode

Headless mode (`-p` flag) runs without an interactive terminal UI, making it perfect for:

- Scripts and automation
- CI/CD pipelines
- Docker containers
- VSCode/IntelliJ extension integration
- Environments without a TTY

```bash
# Basic usage
tnt -p "Generate a conventional commit name for the current git changes."

# With piped input
echo "Review this code" | tnt -p

# JSON output for scripting
tnt -p "Analyze the code" --format json

# Silent mode (strips thinking tags)
tnt -p "Write a README" --silent
```

**TTY-less Environments**: Headless mode is designed to work in environments without a terminal (TTY), such as when called from VSCode/IntelliJ extensions using terminal commands. The CLI will not attempt to read stdin or initialize the interactive UI when running in headless mode with a supplied prompt.

### Session Management

The CLI automatically saves your chat history for each terminal session. You can resume where you left off:

```bash
# Resume the last session in this terminal
tnt --resume

# List recent sessions and choose one to resume
tnt ls

# List sessions in JSON format (for scripting)
tnt ls --json
```

## Command Line Options

- `-p`: Run in headless mode (no TUI)
- `--config <path>`: Specify agent configuration path
- `--resume`: Resume the last session for this terminal
- `<prompt>`: Optional prompt to start with

## Environment Variables

- `FORCE_NO_TTY`: Force TTY-less mode, prevents stdin reading (useful for testing and automation)

## Commands

- `tnt`: Start an interactive chat session
- `tnt ls`: List recent sessions with TUI selector to choose one to resume
- `tnt login`: Authenticate with Continue
- `tnt logout`: Sign out of current session
- `tnt remote`: Launch a remote instance
- `tnt serve`: Start HTTP server mode

### Session Listing (`tnt ls`)

Shows recent sessions, limited by screen height to ensure it fits on your terminal.

- `--json`: Output in JSON format for scripting (always shows 10 sessions)

## TTY-less Support

The CLI fully supports running in environments without a TTY (terminal):

```bash
# From Docker without TTY allocation
docker run --rm my-image tnt -p "Generate docs"

# From CI/CD pipeline
tnt -p "Review changes" --format json

# From VSCode/IntelliJ extension terminal tool
tnt -p "Analyze code" --silent
```

The CLI automatically detects TTY-less environments and adjusts its behavior:

- Skips stdin reading when a prompt is supplied
- Disables interactive UI components
- Ensures clean stdout/stderr output

For more details, see [`spec/tty-less-support.md`](./spec/tty-less-support.md).
