# Real repository vulnerability pairs

A small, deliberately selected subset of Cisco Foundation AI's [VLoc Bench](https://github.com/cisco-foundation-ai/vulnerability-localization-benchmark), pinned at `9ea70b1a937f266ace41f9477d705edbe7af1313`. It complements the hand-written Python fixtures by exercising navigation through complete repositories.

| Family | Repository | Requested CWE | Advisory | Vulnerable file labels | License |
| --- | --- | --- | --- | --- | --- |
| `urllib3_redirect` | urllib3/urllib3 | CWE-200 | [GHSA-www2-v7xj-xrc6](https://github.com/advisories/GHSA-www2-v7xj-xrc6) | `urllib3/poolmanager.py`, `urllib3/util/retry.py` | MIT |
| `wlc_tls` | WeblateOrg/wlc | CWE-295 | [GHSA-2mmv-7rrp-g8xh](https://github.com/WeblateOrg/wlc/security/advisories/GHSA-2mmv-7rrp-g8xh) | `wlc/__init__.py` | GPL-3.0 |
| `haystack_template` | deepset-ai/haystack | CWE-1336 | [GHSA-hx9v-6r9f-w677](https://github.com/deepset-ai/haystack/security/advisories/GHSA-hx9v-6r9f-w677) | Five builder/router/converter/pipeline files listed in the catalog | Apache-2.0 |

The staged snapshots contain 137 regular files for each urllib3 revision, 144 for each Weblate revision, and 972/971 for the vulnerable/fixed Haystack revisions. Ground-truth labels are a small subset of these files.

`cases.json` records both exact commits, archive URLs and SHA-256 hashes, patch links, upstream licenses and file labels from the benchmark manifest. The fixed snapshot has an empty expected finding list for the recorded vulnerability. This is a benchmark label, not proof that the whole repository is free of that CWE or other vulnerabilities. Patch-touched files are an imperfect proxy for the files containing the root cause. Unlike the hand-written fixtures, these historical snapshots have not had their original application test suites executed here.

## Run

Start the two local model servers as described in the root README. From the repository root:

```sh
# Download missing snapshots, verify checksums, then scan both models three times.
.venv/bin/python scripts/scan_real_examples.py \
  --download --repeats 3 --output reports/real-repositories-local --strict

# Smaller check using the existing cache: one pair, one model, one repetition.
.venv/bin/python scripts/scan_real_examples.py \
  --family wlc_tls --model antares-350m --repeats 1 \
  --output reports/wlc-local --strict
```

The default run is **36 investigations**: three pairs × two snapshots × two models × three repetitions. The default repository tool budget is 15, with a 300-second timeout per investigation. All results are retained; there is no automatic retry of a failed or inaccurate investigation. CLI-internal retries remain governed by the installed CLI. Outputs must be new directories, outside the snapshot cache and scan targets.

Downloads go to ignored `.cache/vloc/`. The runner checks SHA-256 before use and refuses a mismatched cache entry. ZIP extraction validates paths and size limits, rejects symlinks and duplicate paths, and copies regular files into a temporary directory named `repository`. `.git` and `.antares*` paths are excluded so repository-provided scanner configuration is not adopted. The snapshot is removed afterward. The CLI may retain investigation traces in its ignored local data directory.

No repository applications, installers, tests or build scripts are executed. Antares receives read-only repository exploration tools through the existing local CLI runtime. This uses the local macOS CLI harness, not the benchmark's Docker harness. Reports retain an archive hash and a tree hash computed from a sorted JSON mapping of relative file paths to content SHA-256 hashes, plus the number of copied files.

Variant names, the catalog and expected answers are outside the scan target. The repository contents themselves are preserved, including tests, documentation and changelogs, which may contain historical security references. This is label isolation, not a claim that all hints inside upstream source have been removed.

## Metrics and provenance

The schema-version-2 output includes every repetition, completion/error information, binary confusion matrices and micro-averaged Phase A file precision/recall/F1. File metrics include only completed vulnerable snapshots. False alarms on fixed snapshots are represented in the confusion matrix; incomplete runs are excluded from correctness counts and shown separately. An empty denominator is `null`, not an invented perfect score.

These results are not a leaderboard reproduction: the subset is small and selected, the inference backend is llama.cpp/Metal with a 16K context, and CLI generation/tool handling differs from the benchmark harness. We do not submit or compare these numbers as equivalent benchmark scores. The three repeats characterize variability on these particular pairs.

The archives retain their upstream licenses and license files. No third-party source archive is checked into this repository or bundled in the VSIX. Catalog metadata and attribution come from the benchmark's [pinned manifest](https://github.com/cisco-foundation-ai/vulnerability-localization-benchmark/blob/9ea70b1a937f266ace41f9477d705edbe7af1313/data/manifest.csv); its framework is Apache-2.0, while the individual repositories retain the licenses above.

See the [recorded results](../../docs/security-expansion-evaluation.md).
