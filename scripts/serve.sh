#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="${ANTARES_GGUF:-$ROOT/models/antares-1b-f16.gguf}"
test -f "$MODEL" || { echo "Missing GGUF: $MODEL" >&2; exit 1; }
exec "$ROOT/build/llama.cpp/bin/llama-server" --model "$MODEL" --alias antares-1b \
  --host 127.0.0.1 --port 8082 --ctx-size 16384 --parallel 1 \
  --gpu-layers 0 --device none --flash-attn off "$@"
