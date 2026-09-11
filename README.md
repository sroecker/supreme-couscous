# Antares local POC

Antares CLI 1.0.0 with `fdtn-ai/antares-1b`, converted to BF16 GGUF and served by llama.cpp on the local Metal GPU. An F16 CPU fallback is also available.

Based on the [Cisco Antares quickstart](https://github.com/cisco-foundation-ai/cookbook/blob/main/1_quickstarts/Quickstart_Antares.md). The wrapper uses the CLI's supported environment configuration instead of changing your global profiles. See the [verbose example report](reports/report-verbose.md) for actual output, investigation steps, and reviewed findings.

## Requirements and layout

The tested platform is macOS on Apple Silicon with Python 3.12, `uv`, `hf`, Git, CMake, Apple command-line developer tools, `unzip`, `curl`, and `jq`. A fresh checkout needs the setup steps below before the launch commands work. Model downloads require approved Hugging Face access. Allow space for at least 6.8 GiB of weights plus dependencies and build files.

| Path | Purpose | Git |
| --- | --- | --- |
| `scripts/` | Launchers and numerical smoke check, with a saved generic test prompt | Tracked |
| `examples/demo/` | Deliberately vulnerable source fixture; scanned without running Flask | Tracked |
| `reports/report-verbose.md` | Reviewed output and interpretation | Tracked |
| `reports/cpu-query/`, `reports/cpu-sweep/` | Original completed demo reports in JSON, Markdown, and SARIF | Tracked snapshots |
| `reports/gpu-query/`, `reports/gpu-sweep/`, `reports/gpu-validation.md` | GPU verification reports and numerical diagnosis | Tracked snapshots |
| `requirements.lock.txt` | Versions installed for this POC, including the local CLI source | Tracked |
| `models/`, `vendor/`, `build/`, `.venv/` | Downloaded weights, upstream source, binaries, and dependencies | Ignored |
| `.antares-data/`, `logs/`, other `reports/` folders | Private run history, diagnostic logs, and subsequent scan results | Ignored |

## Run

Start the model in one terminal:

```sh
./scripts/serve.sh
```

In another terminal:

```sh
curl http://127.0.0.1:8082/health
.venv/bin/python scripts/check_endpoint.py
./scripts/antares.sh plan examples/demo --max-cwes 3
./scripts/antares.sh query examples/demo --cwe CWE-89 --output reports/my-query
./scripts/antares.sh sweep examples/demo --max-cwes 3 --workers 1 --no-tui --output reports/my-sweep
jq '{summary, warnings, findings}' reports/my-query/report.json
```

Use a fresh output directory for each run. Stop the server with Ctrl-C in its terminal. Port 8082 exposes `/v1/completions` with model alias `antares-1b`; Antares serializes its own tool prompt without a server-side chat template. One server slot and one sweep worker limit local resource use. Server context is 16,384 tokens, matching the CLI default.

The default launcher uses BF16 weights with `--gpu-layers all --flash-attn off`. Use `ANTARES_DEVICE=cpu ./scripts/serve.sh` to select the original F16 CPU configuration (`--device none --gpu-layers 0`). Stop the existing server before switching modes. `ANTARES_GGUF` overrides either default model path; F16 and F32 GGUFs are not suitable for normal batched GPU inference with this checkpoint.

The GPU failure was caused by numerical range: the reference model has an MLP activation of about 84,489, exceeding F16's finite limit of 65,504. This llama.cpp revision's Metal batched matrix kernels use half operands for both F16 and F32 weights. BF16 takes a separate kernel path and preserves the wider exponent range. See [GPU validation](reports/gpu-validation.md) for evidence and reproduction commands. No upstream source patch is required.

`examples/demo/app.py` is an intentionally vulnerable, unexecuted scan fixture with SQL built from request input. Candidate findings require source review. Replace `examples/demo` with an absolute repository path to scan your code, keep reports and `.antares-data` outside that target, and configure its `.antares.toml` exclusions first.

Model inference stays on localhost. The tracked reports contain only the demo fixture's results; subsequent reports and private investigation history are ignored by Git. Keep the tracked snapshot directories unchanged and use fresh names for new runs. Existing diagnostic logs are in `logs/`; redirect future server output there with `mkdir -p logs` followed by `./scripts/serve.sh > logs/llama-server.log 2>&1` if desired.

## Verification

The default BF16 GPU configuration passes the full Antares prompt check with finite probabilities and a valid terminal tool call. Earlier CPU reports below are retained as historical baseline results. See [GPU validation](reports/gpu-validation.md) for the new scan outcomes.

The CPU-focused query in `reports/cpu-query` completed in 41.84 seconds and identified `app.py` for CWE-89. Source review confirms direct concatenation of `request.args` into SQL. It had zero generation errors and no incomplete reason. Two tool calls failed during investigation, but the model recovered and made an explicit final submission.

The automatic three-CWE sweep in `reports/cpu-sweep` completed in 167.57 seconds with zero generation errors, zero failed workers, no incomplete reason, and null error messages for all three workers. Seven tool calls failed but the investigations recovered. Both runs saved JSON, Markdown, and SARIF reports.

Source review of the sweep findings:

| Check | Review |
| --- | --- |
| CWE-20 | Broad input-validation concern; CWE-89 is the more specific demonstrated weakness. |
| CWE-78 | Unsupported: this fixture invokes no OS commands. |
| CWE-79 | Unsupported by this fixture: it returns a JSON object and has no HTML rendering sink. |

The automatic top-three selection omitted CWE-89. This POC demonstrates a working local investigation workflow, not reliable vulnerability coverage or validated findings for every selected CWE. The local `reports/diagnostics/verified-query` is an incomplete numerical-failure diagnostic and must not be treated as a successful scan.

The smoke check uses the actual generic Antares CWE-89 prompt, requires finite token probabilities, and exits nonzero on a numerical failure. A healthy HTTP endpoint alone does not establish usable model inference.

## Recreate dependencies and model

An authenticated Hugging Face account with approved `fdtn-ai/antares-1b` access is required. Authenticate using `hf auth login` in your terminal.

```sh
hf download fdtn-ai/antares-1b --revision 10417eb35641b32e7141157db19c76eb545193b6 --local-dir models/antares-1b
mkdir -p vendor
# Extract into a new directory; skip if already extracted.
unzip models/antares-1b/assets/antares-cli.zip -d vendor/antares-cli
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.lock.txt
git clone https://github.com/ggml-org/llama.cpp.git vendor/llama.cpp
git -C vendor/llama.cpp checkout 451b89bae0c4b1dd612eb503ceace906c01ddcc9
cmake -S vendor/llama.cpp -B build/llama.cpp -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build build/llama.cpp --target llama-server -j 6
.venv/bin/python vendor/llama.cpp/convert_hf_to_gguf.py models/antares-1b --outfile models/antares-1b-f16.gguf --outtype f16
.venv/bin/python vendor/llama.cpp/convert_hf_to_gguf.py models/antares-1b --outfile models/antares-1b-bf16.gguf --outtype bf16
```

The launcher uses the locally compiled llama.cpp revision `451b89bae0c4b1dd612eb503ceace906c01ddcc9`, matching the converter. GGUF conversion recognizes this all-attention Granite model as the standard Granite architecture. Original weights, F16 GGUF, and BF16 GGUF each occupy approximately 3.4 GiB. Skip the F16 conversion if you do not need the CPU fallback. An additional 6.8 GiB F32 GGUF was generated locally for diagnostics and is not needed by the launcher.
