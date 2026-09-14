#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/model_profile.sh"
case "${ANTARES_DEVICE:-metal}" in
  metal) PRECISION=bf16; DEVICE_ARGS=(--gpu-layers all) ;;
  cpu) PRECISION=f16; DEVICE_ARGS=(--gpu-layers 0 --device none) ;;
  *) echo "ANTARES_DEVICE must be metal or cpu" >&2; exit 2 ;;
esac
MODEL_NAME="${ANTARES_MODEL:-antares-1b}"
case "$MODEL_NAME" in
  antares-1b|antares-350m) ;;
  *) echo "ANTARES_MODEL must be antares-1b or antares-350m" >&2; exit 2 ;;
esac
MODEL="${ANTARES_GGUF:-$ROOT/models/$MODEL_NAME-$PRECISION.gguf}"
test -f "$MODEL" || { echo "Missing GGUF: $MODEL" >&2; exit 1; }
exec "$ROOT/build/llama.cpp/bin/llama-server" --model "$MODEL" --alias "$MODEL_NAME" \
  --host 127.0.0.1 --port "${ANTARES_PORT:-8082}" --ctx-size 16384 --parallel 1 \
  "${DEVICE_ARGS[@]}" --flash-attn off "$@"
