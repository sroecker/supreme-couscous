"""Compare Metal execution settings using the saved Antares prompt."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ("baseline", {}, []),
    ("no-concurrency", {"GGML_METAL_CONCURRENCY_DISABLE": "1"}, []),
    ("no-graph-optimize", {"GGML_METAL_GRAPH_OPTIMIZE_DISABLE": "1"}, []),
    ("ubatch-1", {}, ["--ubatch-size", "1"]),
    ("flash-attention", {}, ["--flash-attn", "on"]),
]
parser = argparse.ArgumentParser()
parser.add_argument("--case", choices=[case[0] for case in CASES], action="append")
parser.add_argument("--model", default="models/antares-1b-bf16.gguf")
args = parser.parse_args()

results = []
(ROOT / "logs").mkdir(exist_ok=True)
for name, overrides, extra in CASES:
    if name not in (args.case or ["baseline"]):
        continue
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 8085)) == 0:
            raise SystemExit("Diagnostic port 8085 is already in use")
    command = [str(ROOT / "build/llama.cpp/bin/llama-server"),
               "--model", str(ROOT / args.model),
               "--alias", "antares-1b", "--host", "127.0.0.1", "--port", "8085",
               "--ctx-size", "16384", "--parallel", "1", "--gpu-layers", "all",
               "--flash-attn", "off", "--verbose", *extra]
    with (ROOT / "logs" / f"gpu-{name}.log").open("w") as log:
        process = subprocess.Popen(command, env={**os.environ, **overrides}, stdout=log, stderr=log)
        try:
            check = subprocess.run([sys.executable, str(ROOT / "scripts/check_endpoint.py"),
                                    "--port", "8085"], capture_output=True, text=True, timeout=150)
            result = {"case": name, "model": args.model, "exit_code": check.returncode, "output": check.stdout,
                      "error": check.stderr}
            results.append(result)
            print(json.dumps(result), flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
output = ROOT / "reports/diagnostics" / f"gpu-{Path(args.model).stem}.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(results, indent=2) + "\n")
