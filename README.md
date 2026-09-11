# Antares local POC

Run `fdtn-ai/antares-1b` locally with Antares CLI 1.0.0 and llama.cpp. The default is **BF16 inference on the Metal GPU**; an F16 CPU fallback is available.

Based on the [Cisco Antares quickstart](https://github.com/cisco-foundation-ai/cookbook/blob/main/1_quickstarts/Quickstart_Antares.md). See [GPU validation](reports/gpu-validation.md) for the working configuration and numerical diagnosis, or the [verbose CPU report](reports/report-verbose.md) for example terminal output and investigation steps.

## Requirements

The tested platform is macOS on Apple Silicon with Python 3.12, `uv`, `hf`, Git, CMake, Apple command-line developer tools, `unzip`, `curl`, and `jq`. The Metal device/runtime must support BF16; use the CPU fallback otherwise.

No llama.cpp source patch is required. The [change history and reverted experiment](reports/gpu-validation.md#what-actually-needed-changing) explain the BF16 conversion fix, launcher changes, and the temporary shader patch that did not solve the issue.

An authenticated Hugging Face account with approved access to `fdtn-ai/antares-1b` is required for downloads. Run `hf auth login` in your terminal. The model weights and BF16 GGUF use approximately 6.8 GiB together; the optional F16 fallback adds about 3.4 GiB. Allow additional space for dependencies and build files.

## First-time setup

Run these commands from the project root. They assume a fresh checkout; skip extraction, cloning, and environment creation if those directories already exist.

```sh
hf download fdtn-ai/antares-1b --revision 10417eb35641b32e7141157db19c76eb545193b6 --local-dir models/antares-1b
mkdir -p vendor
unzip models/antares-1b/assets/antares-cli.zip -d vendor/antares-cli
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.lock.txt

git clone https://github.com/ggml-org/llama.cpp.git vendor/llama.cpp
git -C vendor/llama.cpp checkout 451b89bae0c4b1dd612eb503ceace906c01ddcc9
cmake -S vendor/llama.cpp -B build/llama.cpp -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build build/llama.cpp --target llama-server -j 6

.venv/bin/python vendor/llama.cpp/convert_hf_to_gguf.py models/antares-1b --outfile models/antares-1b-bf16.gguf --outtype bf16
```

`requirements.lock.txt` records the installed dependency versions and includes `./vendor/antares-cli`, so extract the CLI before installing dependencies. This is a version snapshot for the tested environment, not a cross-platform lock with artifact hashes. The converter and server use the same pinned, unmodified llama.cpp revision.

For the optional CPU fallback, also convert F16 weights:

```sh
.venv/bin/python vendor/llama.cpp/convert_hf_to_gguf.py models/antares-1b --outfile models/antares-1b-f16.gguf --outtype f16
```

## Run

Start the GPU server in one terminal:

```sh
./scripts/serve.sh
```

In another terminal, verify inference and follow the plan/query/sweep workflow:

```sh
curl http://127.0.0.1:8082/health
.venv/bin/python scripts/check_endpoint.py --max-tokens 128
./scripts/antares.sh plan examples/demo --max-cwes 3
./scripts/antares.sh query examples/demo --cwe CWE-89 --output reports/my-query
jq '{summary, warnings: (.warnings // []), findings}' reports/my-query/report.json
# Review the focused result before expanding coverage.
./scripts/antares.sh sweep examples/demo --max-cwes 3 --workers 1 --no-tui --output reports/my-sweep
```

Use a fresh output directory for each run. Stop the server with Ctrl-C in its terminal. A second server cannot use the same port. For file logging, create `logs/` and run `./scripts/serve.sh > logs/llama-server.log 2>&1` in the foreground.

The endpoint is `http://127.0.0.1:8082/v1/completions`, with model alias `antares-1b`, a 16,384-token context, one server slot, and disabled flash attention. Antares serializes its own tool prompt without a server-side chat template. The CLI calls this backend `remote` because it uses HTTP; inference remains local.

### Configuration and scripts

| Interface | Behavior |
| --- | --- |
| `./scripts/serve.sh` | Uses `models/antares-1b-bf16.gguf` and offloads all layers to Metal. Extra arguments are forwarded to llama-server. |
| `ANTARES_DEVICE=cpu ./scripts/serve.sh` | Uses F16 weights with `--gpu-layers 0 --device none`; stop the GPU server before switching. |
| `ANTARES_GGUF=/absolute/path/model.gguf` | Overrides the selected model file. Use BF16 for batched Metal inference with this checkpoint. |
| `./scripts/antares.sh …` | Invokes the project-local CLI, fixes its endpoint/model, clears the API key, and stores history under `.antares-data/`. Global Antares profiles are unchanged. |
| `.venv/bin/python scripts/check_endpoint.py` | Waits for health, then checks finite token probabilities with the saved 1,020-token prompt. Options: `--port` (8082) and `--max-tokens` (16). Exits nonzero on failure. |
| `.venv/bin/python scripts/diagnose_gpu.py` | Runs an isolated BF16 GPU check on port 8085, then stops its own server. See the diagnostic commands below. |

If you override the server port or alias, also pass the matching `--endpoint` or `--model` to the Antares command and the matching `--port` to the smoke check.

### Scan another repository

Replace `examples/demo` with an absolute repository path. Keep reports and `.antares-data` outside that target, and configure exclusions in its `.antares.toml`; Git ignore rules are not automatically Antares exclusions. The bundled `examples/demo/app.py` is deliberately vulnerable and is inspected as source without running Flask.

Check `summary.generation_errors`, `summary.failed_workers`, `summary.incomplete_reason`, warnings, and sweep worker errors before interpreting findings. A completed scan does not validate its findings. The CLI's `query` and `sweep` commands normally exit 0 on completion and 2 for invalid or incomplete work; these examples do not use `--fail-on-findings`.

## Verified results

All four saved runs completed with zero generation errors, zero failed workers, no warnings, and no incomplete reason. Tool-call failures were recovered within the investigations.

| Run | Duration | Findings | Failed tool calls | Report |
| --- | --- | --- | --- | --- |
| BF16 GPU, CWE-89 query | 60.05 s | SQL injection in `app.py`, supported by source review | 6 | [GPU query](reports/gpu-query/report.md) |
| BF16 GPU, three-CWE sweep | 124.90 s | CWE-20, CWE-78, CWE-79 in `app.py` | 12 | [GPU sweep](reports/gpu-sweep/report.md) |
| F16 CPU, CWE-89 query | 41.84 s | SQL injection in `app.py`, supported by source review | 2 | [CPU query](reports/cpu-query/report.md) |
| F16 CPU, three-CWE sweep | 167.57 s | CWE-20, CWE-78, CWE-79 in `app.py` | 7 | [CPU sweep](reports/cpu-sweep/report.md) |

These are different model investigations, not controlled CPU/GPU speed benchmarks. Each report folder includes JSON, Markdown, and SARIF.

The automatic top-three selection omitted CWE-89. Source review supports the focused SQL-injection finding: request input is concatenated directly into SQL. CWE-20 is broad; the sweep's CWE-78 and CWE-79 findings are unsupported by this fixture, which invokes no OS commands and returns JSON without an HTML-rendering sink. `likelihood_of_exploit` is taxonomy metadata, not confidence in a finding.

## GPU troubleshooting and diagnosis

F16 and F32 GGUFs produced repeated `@` characters and non-finite probabilities in normal batched Metal inference. A measured MLP activation of about 84,489 exceeds F16's finite limit of 65,504. The pinned Metal matrix kernels use half operands for both F16 and F32 weights; BF16 uses a wider-range path. The fix requires BF16 GGUF, not an upstream source patch. Full evidence is in [GPU validation](reports/gpu-validation.md).

For a missing GGUF, rerun the corresponding conversion command. For connection errors, confirm the server has finished loading and check its log. A healthy HTTP response alone is insufficient; run the numerical smoke check.

To compare the failing and working GPU paths without replacing the main endpoint:

```sh
.venv/bin/python scripts/diagnose_gpu.py --model models/antares-1b-f16.gguf
.venv/bin/python scripts/diagnose_gpu.py --model models/antares-1b-bf16.gguf
```

The diagnostic defaults to `--case baseline`. Repeat `--case` to select `no-concurrency`, `no-graph-optimize`, `ubatch-1`, or `flash-attention`. It refuses an occupied port 8085 and saves results to `reports/diagnostics/gpu-<model-stem>.json`. Inspect each result's `exit_code`; the diagnostic runner records failed checks rather than adopting their exit status. Reusing a model filename replaces its diagnostic JSON, and reusing a case replaces `logs/gpu-<case>.log`. The F16 baseline is expected to fail. Run cases sequentially to limit memory use.

## Repository layout and local artifacts

| Path | Purpose | Git |
| --- | --- | --- |
| `scripts/` | Launchers, checks, GPU diagnostics, and saved generic Antares prompt | Tracked |
| `examples/demo/` | Deliberately vulnerable scan fixture | Tracked |
| `reports/report-verbose.md`, `reports/gpu-validation.md` | Reviewed output and numerical diagnosis | Tracked |
| `reports/cpu-query/`, `reports/cpu-sweep/`, `reports/gpu-query/`, `reports/gpu-sweep/` | Completed demo report snapshots; use different folders for new runs | Tracked |
| `requirements.lock.txt` | Installed dependency version snapshot | Tracked |
| `models/`, `vendor/`, `build/`, `.venv/` | Weights, upstream source, binaries, dependencies | Ignored |
| `.antares-data/`, `logs/`, other `reports/` folders | Private history, diagnostic logs, subsequent scan results | Ignored |

The local F32 GGUF is a 6.8 GiB diagnostic artifact and is not used by either launcher mode. `reports/diagnostics/verified-query` records an earlier incomplete run and is not a successful scan. Diagnostic artifacts and private traces may be absent in a fresh checkout; the tracked reports are self-contained. Model downloads and conversion are required again if you remove `models/`; removing `build/` or `.venv/` requires rebuilding or reinstalling.

The project has an [MIT license](LICENSE). Downloaded Antares and llama.cpp components retain their own upstream licenses and access conditions; their source and weights are not included in Git.
