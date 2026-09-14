#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test -r "$ROOT/scripts/model_profile.sh" || { echo "Missing scripts/model_profile.sh. Restore the launcher files from this checkout." >&2; exit 2; }
source "$ROOT/scripts/model_profile.sh"
test -x "$ROOT/build/llama.cpp/bin/llama-server" || { echo "llama-server missing. Build llama.cpp using README.md before starting the server." >&2; exit 2; }
case "${ANTARES_DEVICE:-metal}" in
  metal) PRECISION=bf16; DEVICE_ARGS=(--gpu-layers all) ;;
  cpu) PRECISION=f16; DEVICE_ARGS=(--gpu-layers 0 --device none) ;;
  *) echo "ANTARES_DEVICE must be metal or cpu" >&2; exit 2 ;;
esac
MODEL_NAME="${ANTARES_MODEL:-antares-1b}"
"$ROOT/.venv/bin/python" -c 'import json,sys; profiles=json.load(open(sys.argv[1])); sys.exit(0 if sys.argv[2] in profiles else 1)' "$ROOT/vscode-extension/src/model-profiles.json" "$MODEL_NAME" \
  || { echo "ANTARES_MODEL must be one of: $("$ROOT/.venv/bin/python" -c 'import json,sys; print(" ".join(sorted(json.load(open(sys.argv[1])).keys())))' "$ROOT/vscode-extension/src/model-profiles.json")" >&2; exit 2; }
MODEL="${ANTARES_GGUF:-$ROOT/models/$MODEL_NAME-$PRECISION.gguf}"
test -f "$MODEL" || { echo "Missing GGUF: $MODEL" >&2; exit 1; }
exec "$ROOT/build/llama.cpp/bin/llama-server" --model "$MODEL" --alias "$MODEL_NAME" \
  --host 127.0.0.1 --port "${ANTARES_PORT}" --ctx-size 16384 --parallel 1 \
  "${DEVICE_ARGS[@]}" --flash-attn off "$@"
