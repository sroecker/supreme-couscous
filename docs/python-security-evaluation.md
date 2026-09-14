# Python security fixture evaluation

This report records one focused query per fixture and model. The suite contains 24 hand-written targets: six CWE families, each with vulnerable, fixed, incomplete-fix and protected-elsewhere variants. Ground truth is established by offline behavioral tests within the [documented assumptions](../examples/python-security/README.md#scope-of-the-protections).

The runner copies only Python source into a neutral `repository` directory. Expected answers, sibling variants and test code are excluded. All 48 investigations use a repository tool budget of 10 and a 300-second per-investigation timeout. No completed investigation is retried to select a preferred answer.

The local setup uses Antares CLI 1.0.0, llama.cpp revision `451b89bae0c4b1dd612eb503ceace906c01ddcc9`, BF16 models, Metal, a 16,384-token context, one server slot and the CLI's default generation settings (temperature 0.3). Server aliases and report model names are checked; loaded weight bytes are not independently verified by the runner. This is a diagnostic snapshot, not a statistically representative Python benchmark.

Raw reports and logs are retained locally under `reports/python-security-run-1/`; the compact tracked JSON preserves every result, its source hashes and CLI summary. CLI completion and finding correctness are separate: incomplete results are not scored as misses or safe outcomes. A recovered/rejected tool call can increment `failed_tool_calls` even when the CLI submits a final decision.

## Results — 14 September 2026

[Machine-readable results](python-security-evaluation.json) include all 48 runs. The strict runner exited **2**, because seven investigations were incomplete. Offline validation passed **41 tests**, including 24 behavioral fixture tests and six evaluation tests.

| Model | Completed / planned | Unsafe detected / completed unsafe | Safe controls flagged / completed safe | Incomplete unsafe / safe | Runtime |
| --- | --- | --- | --- | --- | --- |
| antares-1b | 24 / 24 | 12 / 12 | 12 / 12 | 0 / 0 | 644.7 s |
| antares-350m | 17 / 24 | 8 / 8 | 9 / 9 | 4 / 3 | 235.8 s |

Each model was assigned 12 unsafe and 12 safe targets. Both models flagged **every completed safe control** in this run. Detecting every completed unsafe target therefore does not demonstrate useful discrimination: an always-positive classifier would do the same. The 350M incomplete investigations reduce coverage further. These results support using the scanner for candidate generation with human review; they do not support treating its findings as confirmed vulnerabilities.

### Confusion matrices

Rows are the fixture's ground truth; columns are the model's completed decision for the requested CWE. “Finding” means at least one file was flagged. The incomplete column is a coverage count outside the conventional 2×2 matrix; those cases contribute to none of TP, FN, FP or TN. Exact file-path correctness remains a separate metric in the JSON.

**Antares 1B**

| Ground truth | Finding | No finding | Incomplete (excluded) |
| --- | ---: | ---: | ---: |
| Unsafe | **12 TP** | **0 FN** | 0 |
| Safe | **12 FP** | **0 TN** | 0 |

**Antares 350M**

| Ground truth | Finding | No finding | Incomplete (excluded) |
| --- | ---: | ---: | ---: |
| Unsafe | **8 TP** | **0 FN** | 4 |
| Safe | **9 FP** | **0 TN** | 3 |

TP = true positive, FN = false negative, FP = false positive, TN = true negative. Among completed cases, 1B precision is **50%** (12/24) and 350M precision is **47.1%** (8/17); specificity is **0%** for both. Completed-case recall is 100%, but coverage is only 17/24 for 350M, and neither model produced a completed negative decision. Therefore the absence of observed false negatives is not evidence of reliable safety judgments. These rates describe this balanced synthetic fixture set, not real-world finding precision.

### Per-case outcomes

**Detected** means the expected CWE and `app.py` were reported. **False positive** names the file flagged in a safe control. **Incomplete** is excluded from correctness scoring.

| Family | Variant | 1B | 350M |
| --- | --- | --- | --- |
| file_download (CWE-22) | vulnerable | Detected | Detected |
| file_download (CWE-22) | fixed | False positive: `app.py` | Incomplete |
| file_download (CWE-22) | incomplete_fix | Detected | Incomplete |
| file_download (CWE-22) | protected_elsewhere | False positive: `policy.py` | False positive: `policy.py` |
| command_report (CWE-78) | vulnerable | Detected | Incomplete |
| command_report (CWE-78) | fixed | False positive: `app.py` | Incomplete |
| command_report (CWE-78) | incomplete_fix | Detected | Incomplete |
| command_report (CWE-78) | protected_elsewhere | False positive: `app.py` | Incomplete |
| url_preview (CWE-918) | vulnerable | Detected | Detected |
| url_preview (CWE-918) | fixed | False positive: `app.py` | False positive: `app.py` |
| url_preview (CWE-918) | incomplete_fix | Detected | Incomplete |
| url_preview (CWE-918) | protected_elsewhere | False positive: `app.py` | False positive: `policy.py` |
| job_config (CWE-502) | vulnerable | Detected | Detected |
| job_config (CWE-502) | fixed | False positive: `app.py` | False positive: `app.py` |
| job_config (CWE-502) | incomplete_fix | Detected | Detected |
| job_config (CWE-502) | protected_elsewhere | False positive: `policy.py` | False positive: `policy.py` |
| tenant_invoice (CWE-639) | vulnerable | Detected | Detected |
| tenant_invoice (CWE-639) | fixed | False positive: `app.py` | False positive: `app.py` |
| tenant_invoice (CWE-639) | incomplete_fix | Detected | Detected |
| tenant_invoice (CWE-639) | protected_elsewhere | False positive: `policy.py` | False positive: `app.py`, `policy.py` |
| html_report (CWE-79) | vulnerable | Detected | Detected |
| html_report (CWE-79) | fixed | False positive: `app.py` | False positive: `app.py` |
| html_report (CWE-79) | incomplete_fix | Detected | Detected |
| html_report (CWE-79) | protected_elsewhere | False positive: `policy.py` | False positive: `app.py`, `policy.py` |

### Incomplete investigations

All seven were 350M queries. None timed out. The CLI recorded the reasons below rather than a valid final decision:

| Case | Reason |
| --- | --- |
| file_download-fixed | Model submitted no valid repository file paths. |
| file_download-incomplete_fix | Model submitted no valid repository file paths. |
| command_report-vulnerable | Model submitted no valid repository file paths. |
| command_report-fixed | Model submitted no valid repository file paths. |
| command_report-incomplete_fix | Model submitted no valid repository file paths. |
| command_report-protected_elsewhere | Model submitted no valid repository file paths. |
| url_preview-incomplete_fix | Model submitted no valid repository file paths. |

### A concrete false positive to review

For 1B scanning `job_config/fixed`, the final model message claimed:

> The configuration parser uses json.loads on untrusted data without restricting allowed structure/types, which can be exploited if the input is crafted to trigger unsafe deserialization in the underlying JSON implementation.

It then submitted `app.py` for CWE-502. The [actual source](../examples/python-security/job_config/fixed/app.py) explicitly checks the dictionary keys, value types and integer range. It uses JSON rather than pickle. The explanation contradicts those checks and provides no evidence for an unsafe JSON implementation. This is an observed model claim, not a confirmed vulnerability.

The local investigation trace contains the source read and final submission; the compact JSON retains the resulting finding and CLI counters. For review practice, compare this case with [the pickle variant](../examples/python-security/job_config/vulnerable/app.py) and the offline test. Do not accept a plausible explanation without checking the source and the trust assumptions.

### Reproduction and limits

Run the commands in the [fixture README](../examples/python-security/README.md#evaluate-the-local-models) with fresh output directories. The source hashes in the JSON identify exactly what was scanned, including the two-file controls. This evaluation was run from a working tree based on `e0df974043c46df603e8ba9909faf8ce01e781f0` with the new fixture/evaluator files; the hashes, rather than that base revision alone, identify the fixture contents.

The `/v1/models` endpoints advertised `antares-1b` and `antares-350m`, BF16 and context size 16384. Process arguments confirmed the corresponding BF16 GGUF paths, `--gpu-layers all`, `--parallel 1` and `--flash-attn off`. The model weight revision was not independently attested. A single stochastic run on short synthetic files cannot establish performance on real repositories, rank the models generally, or estimate Python CWE prevalence.
