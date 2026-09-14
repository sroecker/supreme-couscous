# Repeated security fixture and repository evaluation

This evaluation extends the original six-family suite with logging leaks, credential redirects, TLS verification, template injection, decompression amplification and async batch limits. Each new family has vulnerable, fixed, incomplete-fix and protected-elsewhere variants. The original single-run results remain in [their historical report](python-security-evaluation.md).

The repeated results show two limitations: both models flagged every completed safe synthetic control, and real repository exploration substantially reduced localization quality and completion. On the repository subset, 1B completed 16/18 investigations with Phase A micro file F1 **0.513**; 350M completed only 2/18, with file F1 **0.000** based on its single completed vulnerable investigation. Neither model produced a completed no-finding decision in either set. Both strict evaluation commands exited **2** because incomplete investigations were retained.

Two distinct sets are evaluated three times with both local models:

- **Synthetic additions:** 24 targets × two models × three repeats = 144 investigations, with a repository tool budget of 10.
- **Real repository pairs:** three vulnerable/patched pairs × two models × three repeats = 36 investigations, with a repository tool budget of 15.

Both use a 300-second per-investigation timeout. Repetitions are separate CLI investigations; every result is retained, and there is no selection of a preferred attempt. The local setup is Antares CLI 1.0.0 with llama.cpp/Metal BF16, model profiles on ports 8082/8086, 16K context, one server slot and the CLI's existing generation settings. Server model labels are not cryptographic attestation of weights.

The expanded offline suite passed 71 tests: 48 synthetic behavioral checks, eight evaluation tests, four snapshot-handling checks, and eleven existing runner/runtime checks. Network clients and subprocesses are mocked in the fixtures; arithmetic template evaluation and small compressed markers establish behavior without executing an exploit payload or stressing resources. The real repository applications and their original tests were not executed.

## Example: a logging false positive

In repetition 1, 1B read the fixed logging fixture and concluded:

> The logger is used in app.py to log request events, and the code indicates logging is present. This file likely contains sensitive information being written to a log file, making it the vulnerable source.

It submitted `app.py` for CWE-532. The [fixture source](../examples/python-security/secret_logging/fixed/app.py) logs only constant event messages; it does not interpolate headers or exception text. Within the fixture's stated logging scope, the trace supplies no evidence that a secret reaches the logger. The quote is an observed model claim, not a confirmed vulnerability. The corresponding local trace is `repository-1789385678009-21131b1e.investigation.jsonl` under `.antares-data/traces/`.

## Example: positive classification with wrong file localization

In the first real-repository repetition, 1B flagged `urllib3/_collections.py` in the vulnerable urllib3 snapshot. It missed both benchmark-labeled files, `urllib3/poolmanager.py` and `urllib3/util/retry.py`. This counts as a binary positive on a vulnerable snapshot, while file precision and recall for that investigation are both zero. In the vulnerable Haystack snapshot, the same pass found one of the five labeled files. These outcomes show why a binary confusion matrix alone is insufficient for repository-scale localization.

## Example: an incomplete repository investigation

In repetition 1 on patched urllib3, 350M repeatedly issued terminal calls that the CLI rejected as empty, attempted to read `src/utils.js`, and submitted that nonexistent path. The CLI reported no valid repository file paths, so the evaluation marks the run incomplete rather than clean. This is a tool-use failure in the observed local harness, not proof that the patch was verified. The local trace is `repository-1789391772913-6834ff02.investigation.jsonl` under `.antares-data/traces/`.

## Interpretation

Confusion matrices count binary presence of the requested CWE. Incomplete investigations contribute to neither true nor false classifications and are reported separately. A positive decision on an unsafe repository can still point to the wrong files. Phase A micro file precision/recall/F1 measures overlap with the vulnerable file labels across completed unsafe cases; undefined denominators are `null`. Fixed-case false alarms are kept out of Phase A file metrics and remain visible in the confusion matrices.

The fixture labels are backed by behavioral tests within [explicit trust assumptions](../examples/python-security/README.md#scope-of-the-protections). Real repository labels come from security-patch-touched files in the [pinned VLoc Bench manifest](https://github.com/cisco-foundation-ai/vulnerability-localization-benchmark/blob/9ea70b1a937f266ace41f9477d705edbe7af1313/data/manifest.csv). They are an imperfect localization target and do not mean the fixed repository has no other vulnerabilities. Repository documentation and tests are preserved and can contain security references; only the external labels and variant directory names are withheld.

This is not a full VLoc Bench reproduction or a leaderboard submission. The selected cases, local CLI harness, inference configuration and aggregation differ. Three repeats describe variation on this small selected set, not uncertainty over all Python software. Source/archive identifiers and per-run content fingerprints are retained in the compact JSON reports.

## Synthetic additions

[Complete machine-readable results](security-additions-evaluation.json). Started `2026-09-14T11:34:14.163782+00:00`, finished `2026-09-14T12:52:41.200071+00:00`. All 144 planned investigations are retained.

| Model | Completed / planned | TP | FN | FP | TN | Incomplete unsafe / safe |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| antares-1b | 72 / 72 | 36 | 0 | 36 | 0 | 0 / 0 |
| antares-350m | 58 / 72 | 29 | 0 | 29 | 0 | 7 / 7 |

TP = finding on an unsafe target; FN = no finding on an unsafe target; FP = finding on a safe/fixed target; TN = no finding on a safe/fixed target. For real repositories, “safe/fixed” refers only to the benchmark label for the recorded vulnerability.

### Phase A file localization

| Model | Completed unsafe investigations | Correct files | Extra files | Missed files | Micro precision | Micro recall | Micro F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| antares-1b | 36 | 36 | 0 | 0 | 1.000 | 1.000 | 1.000 |
| antares-350m | 29 | 29 | 0 | 0 | 1.000 | 1.000 | 1.000 |

### Repetition comparison

| Repeat | Model | Completed | TP | FN | FP | TN | Incomplete | File F1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | antares-1b | 24 | 12 | 0 | 12 | 0 | 0 | 1.000 |
| 1 | antares-350m | 20 | 10 | 0 | 10 | 0 | 4 | 1.000 |
| 2 | antares-1b | 24 | 12 | 0 | 12 | 0 | 0 | 1.000 |
| 2 | antares-350m | 19 | 9 | 0 | 10 | 0 | 5 | 1.000 |
| 3 | antares-1b | 24 | 12 | 0 | 12 | 0 | 0 | 1.000 |
| 3 | antares-350m | 19 | 10 | 0 | 9 | 0 | 5 | 1.000 |

### Outcomes by target

Each cell counts the three retained repetitions. Finding/no-finding describes the binary decision, not file-location correctness.

| Target | Model | Finding | No finding | Incomplete |
| --- | --- | ---: | ---: | ---: |
| secret_logging-vulnerable | antares-1b | 3 | 0 | 0 |
| secret_logging-vulnerable | antares-350m | 3 | 0 | 0 |
| secret_logging-fixed | antares-1b | 3 | 0 | 0 |
| secret_logging-fixed | antares-350m | 2 | 0 | 1 |
| secret_logging-incomplete_fix | antares-1b | 3 | 0 | 0 |
| secret_logging-incomplete_fix | antares-350m | 2 | 0 | 1 |
| secret_logging-protected_elsewhere | antares-1b | 3 | 0 | 0 |
| secret_logging-protected_elsewhere | antares-350m | 3 | 0 | 0 |
| redirect_credentials-vulnerable | antares-1b | 3 | 0 | 0 |
| redirect_credentials-vulnerable | antares-350m | 1 | 0 | 2 |
| redirect_credentials-fixed | antares-1b | 3 | 0 | 0 |
| redirect_credentials-fixed | antares-350m | 2 | 0 | 1 |
| redirect_credentials-incomplete_fix | antares-1b | 3 | 0 | 0 |
| redirect_credentials-incomplete_fix | antares-350m | 2 | 0 | 1 |
| redirect_credentials-protected_elsewhere | antares-1b | 3 | 0 | 0 |
| redirect_credentials-protected_elsewhere | antares-350m | 2 | 0 | 1 |
| tls_validation-vulnerable | antares-1b | 3 | 0 | 0 |
| tls_validation-vulnerable | antares-350m | 2 | 0 | 1 |
| tls_validation-fixed | antares-1b | 3 | 0 | 0 |
| tls_validation-fixed | antares-350m | 2 | 0 | 1 |
| tls_validation-incomplete_fix | antares-1b | 3 | 0 | 0 |
| tls_validation-incomplete_fix | antares-350m | 3 | 0 | 0 |
| tls_validation-protected_elsewhere | antares-1b | 3 | 0 | 0 |
| tls_validation-protected_elsewhere | antares-350m | 3 | 0 | 0 |
| template_rendering-vulnerable | antares-1b | 3 | 0 | 0 |
| template_rendering-vulnerable | antares-350m | 2 | 0 | 1 |
| template_rendering-fixed | antares-1b | 3 | 0 | 0 |
| template_rendering-fixed | antares-350m | 3 | 0 | 0 |
| template_rendering-incomplete_fix | antares-1b | 3 | 0 | 0 |
| template_rendering-incomplete_fix | antares-350m | 3 | 0 | 0 |
| template_rendering-protected_elsewhere | antares-1b | 3 | 0 | 0 |
| template_rendering-protected_elsewhere | antares-350m | 0 | 0 | 3 |
| compressed_attachment-vulnerable | antares-1b | 3 | 0 | 0 |
| compressed_attachment-vulnerable | antares-350m | 3 | 0 | 0 |
| compressed_attachment-fixed | antares-1b | 3 | 0 | 0 |
| compressed_attachment-fixed | antares-350m | 3 | 0 | 0 |
| compressed_attachment-incomplete_fix | antares-1b | 3 | 0 | 0 |
| compressed_attachment-incomplete_fix | antares-350m | 2 | 0 | 1 |
| compressed_attachment-protected_elsewhere | antares-1b | 3 | 0 | 0 |
| compressed_attachment-protected_elsewhere | antares-350m | 3 | 0 | 0 |
| batch_jobs-vulnerable | antares-1b | 3 | 0 | 0 |
| batch_jobs-vulnerable | antares-350m | 3 | 0 | 0 |
| batch_jobs-fixed | antares-1b | 3 | 0 | 0 |
| batch_jobs-fixed | antares-350m | 3 | 0 | 0 |
| batch_jobs-incomplete_fix | antares-1b | 3 | 0 | 0 |
| batch_jobs-incomplete_fix | antares-350m | 3 | 0 | 0 |
| batch_jobs-protected_elsewhere | antares-1b | 3 | 0 | 0 |
| batch_jobs-protected_elsewhere | antares-350m | 3 | 0 | 0 |

### Incomplete reasons

- 14: Model submitted no valid repository file paths.

## Real repository pairs

[Complete machine-readable results](real-repositories-evaluation.json). Started `2026-09-14T12:52:43.017782+00:00`, finished `2026-09-14T13:51:50.959985+00:00`. All 36 planned investigations are retained.

| Model | Completed / planned | TP | FN | FP | TN | Incomplete unsafe / safe |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| antares-1b | 16 / 18 | 9 | 0 | 7 | 0 | 0 / 2 |
| antares-350m | 2 / 18 | 1 | 0 | 1 | 0 | 8 / 8 |

TP = finding on an unsafe target; FN = no finding on an unsafe target; FP = finding on a safe/fixed target; TN = no finding on a safe/fixed target. For real repositories, “safe/fixed” refers only to the benchmark label for the recorded vulnerability.

### Phase A file localization

| Model | Completed unsafe investigations | Correct files | Extra files | Missed files | Micro precision | Micro recall | Micro F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| antares-1b | 9 | 10 | 5 | 14 | 0.667 | 0.417 | 0.513 |
| antares-350m | 1 | 0 | 1 | 2 | 0.000 | 0.000 | 0.000 |

### Repetition comparison

| Repeat | Model | Completed | TP | FN | FP | TN | Incomplete | File F1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | antares-1b | 6 | 3 | 0 | 3 | 0 | 0 | 0.364 |
| 1 | antares-350m | 1 | 1 | 0 | 0 | 0 | 5 | 0.000 |
| 2 | antares-1b | 5 | 3 | 0 | 2 | 0 | 1 | 0.625 |
| 2 | antares-350m | 0 | 0 | 0 | 0 | 0 | 6 | — |
| 3 | antares-1b | 5 | 3 | 0 | 2 | 0 | 1 | 0.500 |
| 3 | antares-350m | 1 | 0 | 0 | 1 | 0 | 5 | — |

### Outcomes by target

Each cell counts the three retained repetitions. Finding/no-finding describes the binary decision, not file-location correctness.

| Target | Model | Finding | No finding | Incomplete |
| --- | --- | ---: | ---: | ---: |
| urllib3_redirect-vulnerable | antares-1b | 3 | 0 | 0 |
| urllib3_redirect-vulnerable | antares-350m | 1 | 0 | 2 |
| urllib3_redirect-fixed | antares-1b | 2 | 0 | 1 |
| urllib3_redirect-fixed | antares-350m | 1 | 0 | 2 |
| haystack_template-vulnerable | antares-1b | 3 | 0 | 0 |
| haystack_template-vulnerable | antares-350m | 0 | 0 | 3 |
| haystack_template-fixed | antares-1b | 3 | 0 | 0 |
| haystack_template-fixed | antares-350m | 0 | 0 | 3 |
| wlc_tls-vulnerable | antares-1b | 3 | 0 | 0 |
| wlc_tls-vulnerable | antares-350m | 0 | 0 | 3 |
| wlc_tls-fixed | antares-1b | 2 | 0 | 1 |
| wlc_tls-fixed | antares-350m | 0 | 0 | 3 |

### Incomplete reasons

- 16: Model submitted no valid repository file paths.
- 1: Report unavailable or invalid: [Errno 2] No such file or directory: '/Users/sroecker/code/antares/reports/real-repositories-3runs/antares-1b/run-2/urllib3_redirect-fixed/report.json'
- 1: Report unavailable or invalid: [Errno 2] No such file or directory: '/Users/sroecker/code/antares/reports/real-repositories-3runs/antares-1b/run-3/wlc_tls-fixed/report.json'


## Reproduce

See the [fixture runner guide](../examples/python-security/README.md#evaluate-the-local-models) and [real repository guide](../examples/real-repositories/README.md). The synthetic run in this report selects only the six new families; the runner defaults to all twelve if no family filters are provided.

```sh
.venv/bin/python scripts/scan_python_examples.py \
  --family secret_logging --family redirect_credentials --family tls_validation \
  --family template_rendering --family compressed_attachment --family batch_jobs \
  --repeats 3 --output reports/python-security-additions-local --strict

.venv/bin/python scripts/scan_real_examples.py \
  --download --repeats 3 --output reports/real-repositories-local --strict
```

Use fresh output directories. The archived first run's raw logs and reports are local under `reports/python-security-additions-3runs/` and `reports/real-repositories-3runs/`; they are not committed. There is no code or package change to the published v0.4.5 extension in this work.
