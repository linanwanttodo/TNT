#!/usr/bin/env bash
# Builds the CLI and assembles the GitHub Release tarball:
#   tnt-cli-v<version>.tar.gz
# The tarball is self-contained: dist/ (code-split bundle), package.json and a
# pruned node_modules holding only the native dependency the bundle imports at
# startup (sqlite3, the full-text index driver). The embeddings runtime is a
# lazy chunk and ships without its natives; npm installs provide them.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

echo "==> Building..."
npm run build

echo "==> Assembling tnt-cli-v${VERSION}.tar.gz"
mkdir -p "$STAGING/package"
cp -r dist "$STAGING/package/dist"
cp package.json "$STAGING/package/package.json"
cp README.md "$STAGING/package/README.md" 2>/dev/null || true

# Prune the dependency set to the single runtime native the bundle needs, and
# install it so the prebuilt binding ships inside the tarball.
node - "$STAGING/package/package.json" <<'EOF'
const fs = require("fs");
const file = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
const sqliteVersion = pkg.dependencies?.sqlite3 ?? "^5.1.7";
pkg.dependencies = { sqlite3: sqliteVersion };
delete pkg.devDependencies;
delete pkg.optionalDependencies;
delete pkg.peerDependencies;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
EOF

(cd "$STAGING/package" && \
  npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error && \
  npm rebuild sqlite3 --ignore-scripts=false --no-audit --no-fund --loglevel=error)

tar -czf "tnt-cli-v${VERSION}.tar.gz" -C "$STAGING" package
ls -lh "tnt-cli-v${VERSION}.tar.gz"
echo "==> Upload with: gh release upload v${VERSION} tnt-cli-v${VERSION}.tar.gz"
