# Antares local POC

Run Antares **1B** or **350M** locally with Antares CLI 1.0.0 and llama.cpp on Apple Silicon. Both models use BF16 Metal inference; 1B is the default.

Based on the [Cisco Antares quickstart](https://github.com/cisco-foundation-ai/cookbook/blob/main/1_quickstarts/Quickstart_Antares.md). This repository includes launchers, vulnerability examples, offline fixture tests, and recorded model results.

## Requirements

- macOS on Apple Silicon with BF16-capable Metal support.
- Python 3.12, `uv`, `hf`, Git, CMake, Apple command-line developer tools, and `unzip`.
- A Hugging Face account with access to the selected Antares models. Authenticate with `hf auth login`.
- Space for model weights, GGUF files, and dependencies: approximately 6.8 GiB for the 1B source weights and BF16 GGUF together. The additional 350M GGUF is approximately 708 MB, plus its source weights.

## Setup

Run commands from the repository root. For an existing checkout, skip environment creation, extraction, or cloning that you have already completed.

### Install dependencies and build llama.cpp

The bundled CLI is extracted from the pinned 1B model download and supports both model sizes.

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
```

`requirements.lock.txt` is the tested environment's dependency snapshot and includes the extracted `vendor/antares-cli` package. Conversion and inference use the same pinned llama.cpp revision.

### Convert the 1B model

```sh
.venv/bin/python vendor/llama.cpp/convert_hf_to_gguf.py models/antares-1b --outfile models/antares-1b-bf16.gguf --outtype bf16
```

### Add the smaller 350M model

Use the same environment and build:

```sh
hf download fdtn-ai/antares-350m --revision cdf6d054fa5f491553ccb1704269cbd1954c6c6e --local-dir models/antares-350m
.venv/bin/python vendor/llama.cpp/convert_hf_to_gguf.py models/antares-350m --outfile models/antares-350m-bf16.gguf --outtype bf16
```

## Run a model

Start a server in its own terminal:

```sh
# 1B on port 8082
./scripts/serve.sh

# Or 350M on port 8086
ANTARES_MODEL=antares-350m ANTARES_PORT=8086 ./scripts/serve.sh
```

Stop a server with Ctrl-C. Different ports allow both models to run side by side.

In the terminal used for scans, select the matching model. The defaults are 1B and port 8082; to use 350M, set:

```sh
export ANTARES_MODEL=antares-350m
export ANTARES_PORT=8086
```

Verify the selected endpoint:

```sh
.venv/bin/python scripts/check_endpoint.py --port "${ANTARES_PORT:-8082}" --max-tokens 128
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTARES_MODEL` | `antares-1b` | Selects `antares-1b` or `antares-350m` for the server and CLI. |
| `ANTARES_PORT` | `8082` | Sets the server port and the CLI's local endpoint port. |
| `ANTARES_ENDPOINT` | Derived from the port | Overrides the CLI URL, normally `http://127.0.0.1:8082/v1/completions`. |
| `ANTARES_GGUF` | Selected model's BF16 file | Overrides the server's weights path. |
| `ANTARES_DEVICE` | `metal` | Selects Metal or `cpu`; CPU mode requires a separately converted F16 GGUF. |

The server uses a 16,384-token context and one slot. Extra arguments to `serve.sh` are forwarded to llama-server. The CLI stores local history in `.antares-data/` and uses HTTP to communicate with the local model.

## Scan code

Use the selected model to plan coverage, investigate a specific CWE, or scan several categories:

```sh
./scripts/antares.sh plan examples/demo --max-cwes 3
./scripts/antares.sh query examples/demo --cwe CWE-89 --output reports/my-query
./scripts/antares.sh sweep examples/demo --max-cwes 3 --workers 1 --no-tui --output reports/my-sweep
```

Use a fresh output directory for each run. Results include JSON, Markdown, and SARIF reports. Review the focused query before expanding coverage.

To scan another repository, replace `examples/demo` with its absolute path. Keep reports and history outside the scan target. Configure exclusions in the target's `.antares.toml`; Git ignore rules are not automatically Antares exclusions.

Check report warnings and completion status before interpreting findings. A completed investigation can still produce false positives or miss vulnerabilities.

## Test examples

The SQL injection demo in `examples/demo/` is deliberately vulnerable and scanned as source.

The [FastMCP OAuth examples](examples/fastmcp-oauth/README.md) provide three vulnerable/fixed pairs covering missing audience validation, token passthrough, and missing privileged-tool scope checks. Run their eight offline behavioral tests in a separate environment:

```sh
uv venv --python 3.12 .venv-fastmcp
uv pip install --python .venv-fastmcp/bin/python -r examples/fastmcp-oauth/requirements.txt
.venv-fastmcp/bin/python examples/fastmcp-oauth/test_fixtures.py
```

With the selected model server running, scan all six variants:

```sh
.venv/bin/python scripts/scan_oauth_examples.py --output reports/my-fastmcp-oauth
```

The runner records expected and actual findings separately from execution status. See the example README for case selection and timeout options.

## Recorded results

| Report | Contents |
| --- | --- |
| [350M validation and comparison](reports/antares-350m.md) | Setup provenance, endpoint output, SQL demo, and comparison with 1B. |
| [1B OAuth results](reports/fastmcp-oauth.md) | Six fixture outcomes, including false positives and an incomplete control scan. |
| [Verbose demo report](reports/report-verbose.md) | Example terminal output and investigation steps. |

Both models flagged all three vulnerable OAuth examples. The 350M model also flagged all three corrected controls; 1B flagged two controls and left one investigation incomplete. These small runs demonstrate the workflow, not reliable security classification or a controlled performance benchmark.

## Repository layout

| Path | Contents |
| --- | --- |
| `scripts/` | Model launchers, endpoint checks, and scan runner. |
| `examples/` | Source fixtures, behavioral tests, and usage instructions. |
| `reports/` | Tracked result snapshots; new run artifacts are ignored by default. |
| `requirements.lock.txt` | Tested dependency version snapshot. |
| `models/`, `vendor/`, `build/` | Local model files, upstream code, and binaries; ignored by Git. |
| `.venv/`, `.venv-fastmcp/` | Local Python environments; ignored by Git. |
| `.antares-data/`, `logs/` | Local history and logs; ignored by Git. |

## VS Code and VSCodium

The [Antares Local extension](vscode-extension/README.md) connects the editor to this POC's local CLI and model endpoints. It supports automatic category sweeps and focused CWE investigations, Web and MCP/OAuth profiles, a guided review panel with automatic draft saving, workspace run history, failed-category retries, freshness-aware JSON export, and explicit local server startup.

```sh
cd vscode-extension
npm ci
npm test
npm run package
```

Install `antares-local-0.4.3.vsix` using **Extensions: Install from VSIX…**, then run **Antares: Configure Local CLI** and paste the path to this project's `.venv/bin/antares`. Start a model server separately and select the matching model in the editor. Right-click a source folder and choose **Antares: Sweep Code** to scan without selecting a CWE.

See [editor validation](docs/vscode-extension-validation.md) for VSCodium test results and current limits. The [improvement plan](docs/reliability-improvement-plan.md) defines the next fixes and acceptance tests; the [integration plan](docs/vscode-integration-plan.md) records the original roadmap.

## License

This project uses the [MIT license](LICENSE). Downloaded Antares and llama.cpp components retain their upstream licenses; model weights and upstream source are not included in Git.
