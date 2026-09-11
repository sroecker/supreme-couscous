#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ANTARES_ENDPOINT=http://127.0.0.1:8082/v1/completions
export ANTARES_MODEL=antares-1b
export ANTARES_DATA_DIR="$ROOT/.antares-data"
unset ANTARES_API_KEY
umask 077
mkdir -p "$ANTARES_DATA_DIR"
exec "$ROOT/.venv/bin/antares" "$@"
