#!/usr/bin/env bash
# Shared model defaults; JSON is also compiled into the extension package.
test -x "$ROOT/.venv/bin/python" || { echo "Antares setup missing: $ROOT/.venv/bin/python. Create the project virtual environment using README.md (Local setup)." >&2; exit 2; }
test -r "$ROOT/vscode-extension/src/model-profiles.json" || { echo "Missing model profiles. Restore vscode-extension/src/model-profiles.json from this checkout." >&2; exit 2; }
ANTARES_MODEL="${ANTARES_MODEL:-antares-1b}"
PROFILE_PORT="$("$ROOT/.venv/bin/python" -c 'import json,sys; profiles=json.load(open(sys.argv[1])); name=sys.argv[2]; sys.exit("Unsupported Antares model: "+name) if name not in profiles else print(profiles[name]["port"])' "$ROOT/vscode-extension/src/model-profiles.json" "$ANTARES_MODEL")"
export ANTARES_MODEL
export ANTARES_PORT="${ANTARES_PORT:-$PROFILE_PORT}"
