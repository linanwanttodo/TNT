#!/usr/bin/env bash
# Installs the working tree as `tnt` without npm.
#
#   bash packages/cli/scripts/install-local.sh [--no-build]
#
# The layout mirrors the GitHub Release tarball (`<install>/package/dist`), so
# the release installer can later replace this copy in place. The only runtime
# dependency outside the bundle is the sqlite3 native module, which is resolved
# through a link to this checkout's node_modules; no package manager runs.
set -euo pipefail

CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${TNT_CLI_HOME:-$HOME/.tnt/cli}"
BIN_DIR="${TNT_CLI_BIN_DIR:-$HOME/.local/bin}"
NODE_BIN="${NODE_BIN:-node}"
CLI_COMMAND="tnt"
BUILD=1

for arg in "$@"; do
    case "$arg" in
        --no-build) BUILD=0 ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: bash scripts/install-local.sh [--no-build]" >&2
            exit 2
            ;;
    esac
done

if ! command -v "$NODE_BIN" &>/dev/null; then
    echo "Error: node was not found. Install Node.js 20 or newer." >&2
    exit 1
fi

"$NODE_BIN" -e '
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Error: Node.js 20 or newer is required, found ${process.versions.node}.`);
  process.exit(1);
}
'

# Never shadow a package manager's own tree; the CLI belongs under ~/.tnt.
case "$INSTALL_DIR" in
    *node_modules*)
        echo "Error: refusing to install inside node_modules: $INSTALL_DIR" >&2
        exit 1
        ;;
esac

cd "$CLI_DIR"

if [ "$BUILD" = 1 ]; then
    echo "==> Building the CLI"
    "$NODE_BIN" validate-aliases.mjs
    "$NODE_BIN" build.mjs
fi

if [ ! -f "$CLI_DIR/dist/tnt.js" ] || [ ! -f "$CLI_DIR/dist/index.js" ]; then
    echo "Error: dist/ is incomplete. Run without --no-build." >&2
    exit 1
fi

echo "==> Installing to $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/package" "$BIN_DIR"

cp -R "$CLI_DIR/dist" "$INSTALL_DIR/package/dist"
cp "$CLI_DIR/package.json" "$INSTALL_DIR/package/package.json"

# sqlite3 is the one native module the startup graph reaches. A link keeps the
# install small and always matches the checkout that built the bundle.
ln -s "$CLI_DIR/node_modules" "$INSTALL_DIR/package/node_modules"

# Built by node directly, so the entry point needs its executable bit again.
chmod +x "$INSTALL_DIR/package/dist/tnt.js"

ln -sfn "$INSTALL_DIR/package/dist/tnt.js" "$BIN_DIR/$CLI_COMMAND"

# Drop the npm shim if an earlier `npm i -g @tnt/cli` left one behind, so PATH
# order cannot bring the package-managed copy back.
NODE_PREFIX="$(cd "$(dirname "$(command -v "$NODE_BIN")")/.." && pwd)"
NPM_SHIM="$NODE_PREFIX/bin/$CLI_COMMAND"
if [ -L "$NPM_SHIM" ]; then
    case "$(readlink "$NPM_SHIM")" in
        *node_modules/@tnt/cli*)
            rm -f "$NPM_SHIM"
            echo "==> Removed the npm shim at $NPM_SHIM"
            echo "    Package files left at $NODE_PREFIX/lib/node_modules/@tnt/cli"
            ;;
    esac
fi

# Verify the installed copy from a neutral directory.
"$NODE_BIN" "$INSTALL_DIR/package/dist/tnt.js" --version >/dev/null
(cd "$INSTALL_DIR/package" && "$NODE_BIN" -e "require('sqlite3')")

VERSION="$("$NODE_BIN" "$INSTALL_DIR/package/dist/tnt.js" --version)"
echo "==> TNT CLI v$VERSION installed"
echo "    binary:  $BIN_DIR/$CLI_COMMAND -> $INSTALL_DIR/package/dist/tnt.js"
echo "    command: $CLI_COMMAND --version"
echo ""
echo "If your shell hashed the old path, run: hash -r"
