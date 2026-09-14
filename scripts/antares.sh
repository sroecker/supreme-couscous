#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test -r "$ROOT/scripts/model_profile.sh" || { echo "Missing scripts/model_profile.sh. Restore the launcher files from this checkout." >&2; exit 2; }
source "$ROOT/scripts/model_profile.sh"
test -x "$ROOT/.venv/bin/antares" || { echo "Antares CLI missing: $ROOT/.venv/bin/antares. Install the CLI into the project virtual environment using README.md." >&2; exit 2; }
test -r "$ROOT/vscode-extension/runtime/antares_runtime.py" || { echo "Missing Antares runtime. Restore vscode-extension/runtime/antares_runtime.py from this checkout." >&2; exit 2; }
export ANTARES_ENDPOINT="${ANTARES_ENDPOINT:-http://127.0.0.1:${ANTARES_PORT}/v1/completions}"
export ANTARES_MODEL="${ANTARES_MODEL:-antares-1b}"
export ANTARES_DATA_DIR="$ROOT/.antares-data"
unset ANTARES_API_KEY
umask 077
mkdir -p "$ANTARES_DATA_DIR"
exec "$ROOT/.venv/bin/python" "$ROOT/vscode-extension/runtime/antares_runtime.py" "$ROOT/.venv/bin/antares" "$@"
