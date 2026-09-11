#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${ANTARES_DEVICE:-metal}" in
  metal) PRECISION=bf16; DEVICE_ARGS=(--gpu-layers all) ;;
  cpu) PRECISION=f16; DEVICE_ARGS=(--gpu-layers 0 --device none) ;;
  *) echo "ANTARES_DEVICE must be metal or cpu" >&2; exit 2 ;;
esac
MODEL="${ANTARES_GGUF:-$ROOT/models/antares-1b-$PRECISION.gguf}"
test -f "$MODEL" || { echo "Missing GGUF: $MODEL" >&2; exit 1; }
exec "$ROOT/build/llama.cpp/bin/llama-server" --model "$MODEL" --alias antares-1b \
  --host 127.0.0.1 --port 8082 --ctx-size 16384 --parallel 1 \
  "${DEVICE_ARGS[@]}" --flash-attn off "$@"
