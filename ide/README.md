# IDE plugin stack

Status: parked, not deleted.

The product surface is the TNT CLI (`extensions/cli`) and the shared engine
(`core/`). The IDE plugins are kept here, working and buildable, but they are
not part of the default build or CI path. Nothing in this directory runs unless
you invoke it explicitly.

## Layout

| Directory   | What it is                                                |
| ----------- | --------------------------------------------------------- |
| `gui/`      | React webview shared by both IDE plugins, built with Vite |
| `vscode/`   | VS Code extension, bundled with esbuild                   |
| `intellij/` | JetBrains plugin, Kotlin and Gradle                       |

## Interfaces that stay stable

Rewriting the plugins later should not require reworking the engine. Keep these
in place:

- `core/protocol/` - message contracts between the IDE hosts and the engine.
  Both plugins implement them, so the shapes are the plugin-facing API.
- `ide/gui/src/context/IdeMessenger.tsx` - the webview side of that contract.
  Every host implements `IIdeMessenger`; the GUI never talks to a host directly.
- `ide/gui/src/context/MockIdeMessenger.ts` - the in-memory host used by GUI
  tests, which doubles as an executable description of the contract.

Source layouts inside `ide/intellij/` keep the upstream Kotlin package
(`com.github.continuedev.continueintellijextension`) and the Gradle project name
`continue-intellij-extension`. Renaming them is a separate decision, not a
prerequisite for resuming work.

## Dependencies

The plugins consume the engine through file links, so they always build against
the checkout they sit in:

- `ide/gui/package.json` - `core`, `@tnt/config-yaml`, `@tnt/terminal-security`
  resolve as `file:../../core` and `file:../../packages/*`
- `ide/vscode/package.json` - `core` and `@tnt/*` resolve as `file:../../core`
  and `file:../../packages/*`

## Resuming work

GUI:

```bash
cd ide/gui
npm install
npm run build          # tsc then vite build, output in dist/
```

VS Code extension:

```bash
cd ide/vscode
npm install
npm run esbuild        # bundle src into out/
npm run package        # copy the GUI build into gui/ and produce a .vsix
```

JetBrains plugin:

```bash
cd ide/intellij
./gradlew buildPlugin
```

The webview assets are copied out of `ide/gui/dist` by
`ide/vscode/scripts/prepackage.js`, which also writes them into
`ide/intellij/src/main/resources/webview`. Build the GUI before packaging
either plugin.

## Tooling that already points here

Root `package.json` watch scripts, `.vscode/`, `.idea/` and the `.github/`
workflows and actions all reference `ide/gui`, `ide/vscode` and `ide/intellij`.
No references to the previous `extensions/vscode`, `extensions/intellij` or
root-level `gui/` paths remain.
