# Antares 350M local validation

The smaller model runs successfully with the existing, unmodified llama.cpp build. The endpoint smoke test and all seven investigations completed. On the six OAuth fixtures it flagged every file, including all three corrected controls. Successful execution therefore does not imply accurate security classification.

## Reproducible configuration

- Model: [fdtn-ai/antares-350m](https://huggingface.co/fdtn-ai/antares-350m), downloaded revision `cdf6d054fa5f491553ccb1704269cbd1954c6c6e` (recorded in local Hugging Face download metadata).
- llama.cpp: `451b89bae0c4b1dd612eb503ceace906c01ddcc9`, no source modifications.
- Conversion: `--outtype bf16`, producing `models/antares-350m-bf16.gguf`, 708,439,584 bytes.
- GGUF SHA-256: `af8afe21d159e9eabfd51c83ea1f4e1907ead83b4681f8d94182b3e2e1fea2ef`.
- Apple Silicon Metal build, `--gpu-layers all --flash-attn off`, context 16,384, one server slot, localhost port 8086, alias `antares-350m`.
- Antares CLI 1.0.0 already includes the 350M model profile. No CLI dependency update or prompt patch was needed.

The [README setup commands](../README.md#add-the-smaller-350m-model) cover download, conversion, launch, and testing. Launchers now honor `ANTARES_MODEL` and `ANTARES_PORT`; the CLI wrapper also honors `ANTARES_ENDPOINT`. Defaults remain 1B on port 8082. Source weights, GGUF files, environments, and full investigation logs remain ignored by Git.

BF16 was selected to retain the source model's numerical range and use the already validated GPU configuration. These tests do not establish that this smaller model needs BF16 or that F16 would fail; no 350M F16/CPU comparison was run.

## Test results

The [endpoint smoke output](antares-350m-smoke.json) records finite probabilities for the saved Antares prompt: 1,020 prompt tokens, 94 generated tokens, 2,921 prompt tokens/s and 77.3 generated tokens/s. It repeated `<think>` markers before producing a terminal call. This is a numerical sanity check, not a reasoning-quality test or controlled throughput benchmark.

The original SQL injection demo completed in 9.94 seconds and localized `app.py` for CWE-89, with zero generation errors, zero failed workers, and no warnings. It recorded seven failed tool calls out of nine total. The [full demo JSON](antares-350m-demo.json) preserves findings and model configuration.

The unchanged FastMCP behavioral suite passed all eight tests in 0.654 seconds. This validates fixture behavior independently of either language model, using the same isolated FastMCP 3.4.7 environment described in the [fixture documentation](../examples/fastmcp-oauth/README.md).

Each OAuth scan used the standard CWE prompt, an individual variant directory, terminal budget 10, temperature 0.3, and a 300-second investigation timeout. No defect-specific hint was added.

| OAuth case | Variant | 350M result | Seconds | Earlier 1B result | Seconds |
| --- | --- | --- | --- | --- | --- |
| Audience / CWE-287 | Vulnerable | Flagged, complete | 9.8 | Flagged, complete | 28.7 |
| Audience / CWE-287 | Fixed | Flagged, false positive | 9.0 | Incomplete | 156.6 |
| Token passthrough / CWE-441 | Vulnerable | Flagged, complete | 9.9 | Flagged, complete | 31.2 |
| Token passthrough / CWE-441 | Fixed | Flagged, false positive | 11.2 | Flagged, false positive | 31.3 |
| Tool scope / CWE-862 | Vulnerable | Flagged, complete | 10.2 | Flagged, complete | 39.3 |
| Tool scope / CWE-862 | Fixed | Flagged, false positive | 9.2 | Flagged, false positive | 33.7 |

All six 350M investigations completed without warnings, timeouts, generation errors, or failed workers; the runner exited 0. They still recorded 4–8 failed tool calls per investigation. An operationally complete scan can contain failed exploration commands and incorrect final findings.

The [350M summary](fastmcp-oauth-350m-summary.json) records model identity, completion, expected paths, actual paths, timings, and counters for every case. Its raw report paths are relative to the ignored local `reports/fastmcp-oauth-350m-run-1/` directory. Compare with the [earlier 1B report](fastmcp-oauth.md), where the incomplete audience control must not be counted as a clean result.

These are single runs over six tiny targets. The 350M run was faster in the recorded investigations, but this is not a controlled speed benchmark: model trajectories, tool failures, and completion behavior differ. Both models found the deliberately vulnerable files; neither demonstrated reliable distinction from the corrected controls. Do not use these results as a standalone security verdict.

Shell syntax and whitespace checks also passed. The model remains available locally on port 8086 for further experiments; restart it with the documented launcher if the process has stopped.
