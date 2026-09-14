#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/model_profile.sh"
export ANTARES_ENDPOINT="${ANTARES_ENDPOINT:-http://127.0.0.1:${ANTARES_PORT:-8082}/v1/completions}"
export ANTARES_MODEL="${ANTARES_MODEL:-antares-1b}"
export ANTARES_DATA_DIR="$ROOT/.antares-data"
unset ANTARES_API_KEY
umask 077
mkdir -p "$ANTARES_DATA_DIR"
exec "$ROOT/.venv/bin/python" "$ROOT/vscode-extension/runtime/antares_runtime.py" "$ROOT/.venv/bin/antares" "$@"
