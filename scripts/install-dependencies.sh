#!/usr/bin/env bash
# Installs the dependencies for the TNT engine and its CLI surface.
# Start developing with:
# - bash scripts/install-dependencies.sh
# - cd packages/cli && npm run dev
set -e

# Check if node version matches .nvmrc
if [ -f .nvmrc ]; then
    required_node_version=$(cat .nvmrc)
    current_node_version=$(node -v)
    
    # Remove 'v' prefix from versions for comparison
    required_version=${required_node_version#v}
    current_version=${current_node_version#v}

    if [ "$required_version" != "$current_version" ]; then
        echo "⚠️  Warning: Your Node.js version ($current_node_version) does not match the required version ($required_node_version)"
        echo "Please consider switching to the correct version using: nvm use"
        
        if [ -t 0 ]; then
            read -p "Press Enter to continue with installation anyway..."
        else
            echo "Continuing with installation anyway..."
        fi
        echo
    fi
fi

echo "Installing root-level dependencies..."
npm install

echo "Building packages (fetch, openai-adapters, config-yaml)..."
node ./scripts/build-packages.js

echo "Installing core dependencies..."
pushd core
## This flag is set because we pull down Chromium at runtime
export PUPPETEER_SKIP_DOWNLOAD='true'
npm install
npm link
popd

echo "Installing CLI dependencies..."
pushd packages/cli
npm install
popd

echo "Installing docs dependencies..."
pushd docs
npm install
popd