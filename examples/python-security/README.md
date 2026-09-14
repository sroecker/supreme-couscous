# Python security examples

Six small application scenarios, each with four variants (24 scan targets):

| Directory | CWE | Behavior under test | Incomplete fix |
| --- | --- | --- | --- |
| `file_download` | CWE-22: Path traversal | Read only files beneath a storage directory | String-prefix containment accepts a sibling directory |
| `command_report` | CWE-78: OS command injection | Pass a validated filename as a subprocess argument | Removing semicolons leaves shell substitutions |
| `url_preview` | CWE-918: Server-side request forgery | Fetch only two trusted document URLs, without following redirects | Checking the initial hostname still permits redirects to internal services |
| `job_config` | CWE-502: Unsafe deserialization | Parse a bounded JSON document with a narrow schema | A size limit does not make pickle safe |
| `tenant_invoice` | CWE-639: Authorization bypass through a user-controlled key | Look up an invoice only for the authenticated tenant | Requiring login does not enforce tenant ownership |
| `html_report` | CWE-79: Cross-site scripting | Escape a title inserted into HTML body text | Removing literal script tags leaves other HTML injection |

Each directory contains `vulnerable`, `fixed`, `incomplete_fix`, and `protected_elsewhere`. The last variant delegates its protection to `policy.py`, testing whether an investigation follows the call into another file. Both unsafe variants should yield a finding in `app.py`; both protected variants should yield none for the requested CWE. Expectations live in `cases.json`, outside each scan target.

These are hand-written behavioral fixtures, not a measurement of CWE frequency in Python software. The selection covers common application patterns and complements the existing SQL injection and FastMCP OAuth examples. MITRE's [2025 Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) provides broader context across languages; its ranking is not Python-specific.

## Run offline checks

From the repository root:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_python*.py' -v
```

The 24 behavioral tests exercise legitimate input and the distinguishing attack or bypass. HTTP and subprocess calls are mocked: no network requests or shell payloads execute. The pickle test uses a harmless callable returning a marker string to establish that deserialization invokes a callable. Six additional tests verify source isolation and scoring behavior.

## Evaluate the local models

Start both servers using the root README (1B on port 8082; 350M on 8086), then:

```sh
.venv/bin/python scripts/scan_python_examples.py --output reports/python-security-local --strict

# A shorter run: four variants, one model
.venv/bin/python scripts/scan_python_examples.py \
  --model antares-350m --family tenant_invoice \
  --output reports/python-invoices --strict
```

Use a new output directory for each run. The runner defaults to both models, a repository tool-call budget of 10 per investigation and a 300-second timeout. `--timeout` and `--tool-budget` adjust those limits. Endpoint selection uses the shared model profiles and overrides inherited `ANTARES_ENDPOINT`/`ANTARES_PORT`, preventing accidental cross-model comparisons.

Only the selected variant's Python source is copied into a temporary directory named `repository`. Neither variant names, expected answers, sibling variants nor tests are copied. The CLI's target is this neutral directory; it is removed after the investigation. Reports and logs remain under the requested output directory. Do not scan this entire examples tree as a benchmark: it contains answers and contradictory variants.

`evaluation.json` is saved atomically before scanning and after each result. It includes the planned run count, timestamps, source SHA-256 hashes, requested/reported model, completion status and exact CWE/path comparisons. Per-model confusion matrices count binary CWE detection, with incomplete unsafe and safe cases kept separate. The report's model label is checked against the requested model; the runner does not independently verify the server's loaded model or weight bytes. Interrupted evaluations retain their finished rows; compare their count with `planned_runs`. Runs are sequential and never silently retried.

Exit codes: **2** if any investigation is incomplete, **1** for completed mismatches with `--strict`, otherwise **0**. Warnings, worker/generation errors, nonzero CLI exits, missing/invalid reports and model mismatches make a result incomplete. An incomplete result is excluded from both miss and false-positive counts. Exact CWE/path scoring is intentionally narrow: a semantically related CWE or a finding assigned to another file is a mismatch requiring human review. Individual failed tool calls are retained in the summary but are not, by themselves, treated as an incomplete run: the CLI can recover and submit a final decision. Its total call counter can exceed the repository budget because it includes other calls or rejected duplicates. This is a small, single-run diagnostic suite, not a general accuracy estimate.

## Try an example in the editor

Open one variant directory as its own workspace in VS Code, VSCodium or Cursor. Run a focused Antares investigation using the CWE in the table (custom CWE entry supports categories beyond the built-in profiles). Read the evidence and open `policy.py` when present. Compare the finding with the behavioral test, then record your review decision. A model's clean report does not establish safety. Antares localizes files; it does not supply a verified exploit or a line-level proof.

Direct editor scans expose the directory name; use the runner for comparisons where answer leakage matters. The existing plugin package requires no change for these examples.

## Scope of the protections

- File downloads assume the storage tree is not concurrently modified by an attacker. Resolution and containment checks do not demonstrate protection against filesystem races.
- Command execution assumes the process environment and executable lookup are trusted. The filename policy deliberately accepts only simple local basenames.
- URL preview is a finite trusted-document service, not an arbitrary URL fetcher. Its allowlisted host and DNS are operator-controlled. These examples do not implement transport-level IP pinning or prove resistance to DNS rebinding.
- Configuration intentionally changes the accepted format from pickle to JSON. Existing pickle clients must migrate; JSON schema validation rejects booleans where an integer is required.
- Invoice access assumes `current_user` comes from trusted authentication and the invoice mapping is an internal repository. Supplying a tenant identifier in a request is not equivalent to authentication.
- HTML escaping applies to HTML body text. JavaScript, CSS and URL insertion require their own context-specific handling.

See the [recorded evaluation](../../docs/python-security-evaluation.md) for observed model behavior and limitations.
