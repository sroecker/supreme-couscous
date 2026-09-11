"""Check numerical validity using the actual Antares system/user prompt."""
import argparse
import json
import math
import time
from pathlib import Path

import httpx
from antares_cli.inference.granite import apply_granite_chat_template

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8082)
parser.add_argument("--max-tokens", type=int, default=16)
args = parser.parse_args()
base_url = f"http://127.0.0.1:{args.port}"
for attempt in range(45):
    try:
        if httpx.get(f"{base_url}/health", timeout=1).status_code == 200:
            break
    except httpx.HTTPError:
        pass
    time.sleep(1)
else:
    raise SystemExit("Server did not become healthy within 45 seconds")
messages = json.loads(Path(__file__).with_name("smoke-messages.json").read_text())
prompt = apply_granite_chat_template(messages)
response = httpx.post(f"{base_url}/completion", json={
    "prompt": prompt, "n_predict": args.max_tokens, "temperature": 0, "n_probs": 2,
    "cache_prompt": False,
}, timeout=90)
response.raise_for_status()
data = response.json()
probs = data.get("completion_probabilities", [])
valid = bool(probs) and all(isinstance(p.get("logprob"), (int, float))
                          and math.isfinite(p["logprob"]) for p in probs)
print(json.dumps({"finite_probabilities": valid, "content": data.get("content"),
                  "timings": data.get("timings")}, indent=2))
raise SystemExit(0 if valid else 1)
