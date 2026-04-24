#!/usr/bin/env bash
# Build the Safari container app for Claude Pulse.
#
# Runs Apple's safari-web-extension-converter against the repository root and
# emits an Xcode project into safari/build/. Open the resulting .xcodeproj in
# Xcode to compile and run the extension.
#
# Requirements: macOS with Xcode (and Command Line Tools) installed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "Error: safari-web-extension-converter only runs on macOS." >&2
	exit 1
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
	echo "Error: safari-web-extension-converter not found." >&2
	echo "Install Xcode (and Command Line Tools: xcode-select --install) and retry." >&2
	exit 1
fi

mkdir -p "${BUILD_DIR}"

xcrun safari-web-extension-converter \
	--project-location "${BUILD_DIR}" \
	--app-name "Claude Pulse" \
	--bundle-identifier "com.claudepulse.safari" \
	--swift \
	--no-open \
	--force \
	"${REPO_ROOT}"

echo ""
echo "Done. Open the generated Xcode project under:"
echo "  ${BUILD_DIR}/Claude Pulse/Claude Pulse.xcodeproj"
echo "then Build & Run (⌘R) to launch Safari with the extension loaded."
