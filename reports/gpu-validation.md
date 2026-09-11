# GPU inference fix: BF16 on Metal

The local Antares endpoint now runs on the GPU using BF16 GGUF. No llama.cpp source changes are needed. The pinned converter and runtime remain at `451b89bae0c4b1dd612eb503ceace906c01ddcc9`.

## Failure and cause

With F16 GGUF, a complete 1,020-token Antares prompt generated repeated `@` characters and non-finite token probabilities. A one-token prompt was not a sufficient compatibility check. CPU-only inference worked.

A float32 Transformers reference pass over the same saved prompt produced finite logits but an input activation with absolute magnitude **84,489.40625** at `model.layers.4.shared_mlp.output_linear`. That exceeds F16's maximum finite value of **65,504**.

The pinned Metal [matrix kernel implementations](https://github.com/ggml-org/llama.cpp/blob/451b89bae0c4b1dd612eb503ceace906c01ddcc9/ggml/src/ggml-metal/kernels/mul_mm.metal) instantiate `kernel_mul_mm_f16_f32` and `kernel_mul_mm_f32_f32` with half-precision operands. The BF16 variant uses bfloat operands. This explains why F32 GGUF weights and F32 KV cache did not solve the overflow, while BF16 GGUF does.

The checkpoint is already stored in BF16. Converting it to BF16 GGUF retains the necessary exponent range without changing its trained weights.

## Diagnostic results

These tests used the saved Antares system/user prompt, cold prompt evaluation, greedy sampling, and token-probability checks. They are local observations, not general hardware benchmarks.

| Configuration | Result |
| --- | --- |
| F16 Metal, normal prompt batch | Non-finite probabilities; repeated `@` output |
| F32 Metal, F32 KV cache | Same failure |
| F16 Metal with fusion, concurrency, or graph optimization disabled individually | Same numerical failure |
| F16 Metal with strict shader math (temporary diagnostic patch, reverted) | Same failure |
| F16 Metal with flash attention enabled | Same failure |
| F16 Metal with `--ubatch-size 1` | Finite output, but prompt processing fell to about 26 tokens/second |
| BF16 Metal, normal prompt batch | Finite output, about 700 prompt tokens/second in the 16-token check |
| F16 CPU with `--device none` | Finite output; original fallback |

The final longer GPU smoke check allowed up to 128 output tokens. The model finished after 54 tokens with finite probabilities and a valid tool call:

```text
Start by identifying the project structure and key source files to focus the review on database access code.
</think>
<tool_call>
{"name": "terminal", "arguments": {"command": "find . -maxdepth 2 | head -n 200"}}
</tool_call>
```

It processed the 1,020-token prompt in 1.523 seconds and generated at approximately 20.8 tokens/second. Different investigation lengths mean scan duration is not a controlled CPU/GPU speed comparison.

A final isolated regression check also passed. Its verbose runtime log confirms `file type = BF16` and `offloaded 41/41 layers to GPU`; this is GPU execution, not an implicit CPU fallback.

## Use the fix

From the project root, convert the already-downloaded checkpoint:

```sh
.venv/bin/python vendor/llama.cpp/convert_hf_to_gguf.py models/antares-1b \
  --outfile models/antares-1b-bf16.gguf --outtype bf16
./scripts/serve.sh
```

The launcher defaults to BF16 and `--gpu-layers all`. It retains a 16,384-token context, one slot, localhost port 8082, and disabled flash attention. Stop any existing server on that port before launching.

In another terminal:

```sh
.venv/bin/python scripts/check_endpoint.py --max-tokens 128
./scripts/antares.sh query examples/demo --cwe CWE-89 --output reports/my-gpu-query
```

For the CPU fallback, stop the GPU server, then use `ANTARES_DEVICE=cpu ./scripts/serve.sh`. This selects the existing F16 GGUF and explicitly disables GPU devices. `ANTARES_GGUF` can override the model file, but an F16/F32 file reintroduces the batched Metal overflow.

## Reproduce the diagnosis

`scripts/diagnose_gpu.py` starts and stops its own server on port 8085, refuses an occupied diagnostic port, and saves results under ignored `reports/diagnostics/`. It leaves the normal endpoint on 8082 alone. Run cases sequentially to limit memory use:

```sh
.venv/bin/python scripts/diagnose_gpu.py --model models/antares-1b-f16.gguf
.venv/bin/python scripts/diagnose_gpu.py --model models/antares-1b-bf16.gguf
```

The script reports each smoke-check exit code; the F16 baseline is expected to fail. Raw diagnostic logs, including the original reference activation measurement, are retained locally in `logs/`. Source modifications used for the strict-math experiment were reverted.

## End-to-end scan verification

The GPU [focused query](gpu-query/report.json) completed in **60.05 seconds**, reported **CWE-89 in `app.py`**, and had zero generation errors, zero failed workers, no warnings, and no incomplete reason. It recovered from six failed tool calls and made an explicit final submission. Source review confirms the unsafe concatenation of request input into SQL.

The GPU [three-CWE sweep](gpu-sweep/report.json) completed in **124.90 seconds**. All three worker error messages were null, with zero generation errors, zero failed workers, no warnings, and no incomplete reason. It recovered from 12 failed tool calls. As in the CPU baseline, it flagged `app.py` for CWE-20, CWE-78, and CWE-79: CWE-20 is broad, and the OS-command-injection and XSS flags are unsupported by this fixture's source. Both runs saved JSON, Markdown, and SARIF reports.

The historical [CPU report](report-verbose.md) is retained unchanged apart from a notice linking to this fix. Numerical correctness does not validate every security finding; reports still require source review.
