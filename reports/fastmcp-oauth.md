# FastMCP OAuth fixture results

Antares localized all three deliberately vulnerable files in this run. It also flagged two corrected controls, and the other control investigation ended incomplete. These results demonstrate a working local scan workflow, but do not establish reliable discrimination between vulnerable and corrected OAuth code.

## Fixtures and independent validation

The [examples and setup instructions](../examples/fastmcp-oauth/README.md) contain three isolated vulnerable/fixed pairs: missing resource audience validation, MCP bearer-token passthrough, and missing privileged-tool scope authorization. The corrected controls address those specific behaviors, not every production OAuth requirement.

Eight offline tests passed using Python 3.12, FastMCP 3.4.7, MCP 1.30.0, PyJWT 2.13.0, and HTTPX 0.28.1:

```text
Ran 8 tests in 1.409s

OK
```

The tests use real JWT verification and temporary RSA keys. They verify wrong/missing audience rejection, valid audience acceptance, expiry and signature rejection, tool scope enforcement, and separation of incoming and upstream credentials. Tool authentication context and downstream HTTP are mocked; no external service or listener is involved. Full HTTP middleware, OAuth discovery, and identity-provider policy are not tested.

## Antares output

The initial six-target run used Antares CLI 1.0.0 and Antares 1B through the local llama.cpp BF16 Metal endpoint on port 8082, with all 41 layers offloaded, flash attention disabled, and a 16,384-token context. Each target received its focused CWE with the standard prompt and `--tool-budget 10`, without an additional defect hint. Only the individual variant directory was scanned; sibling controls, tests, and explanatory documentation were outside the target.

| Case | Variant | CWE | Expected result | Observed result | Duration |
| --- | --- | --- | --- | --- | --- |
| Audience | Vulnerable | CWE-287 | Flag `server.py` | Flagged; complete | 28.7 s |
| Audience | Fixed | CWE-287 | No finding | Incomplete; no final submission | 156.6 s |
| Token passthrough | Vulnerable | CWE-441 | Flag `server.py` | Flagged; complete | 31.2 s |
| Token passthrough | Fixed | CWE-441 | No finding | Flagged; false positive for this control | 31.3 s |
| Tool scope | Vulnerable | CWE-862 | Flag `server.py` | Flagged; complete | 39.3 s |
| Tool scope | Fixed | CWE-862 | No finding | Flagged; false positive for this control | 33.7 s |

The audience control returned `Model ended without an explicit final submission.` It recorded 50 tool calls, including 47 failed calls, despite the configured terminal-call budget. Its empty findings list is **not a successful clean result**. The batch therefore exited 2. All six reports recorded zero generation errors and zero failed workers; those counters alone do not establish completion or correctness.

For example, the corrected tool-scope file still received this model finding:

```json
{
  "title": "Missing Authorization",
  "file_path": "server.py",
  "cwe_ids": ["CWE-862"],
  "submission_rank": 1,
  "likelihood_of_exploit": "High"
}
```

The corrected callback explicitly requires `audit:export`, and the offline tests verify denial without that scope and acceptance with it. Similarly, the corrected proxy obtains a separate upstream token for its deliberately service-level operation; its test verifies that the MCP token is never forwarded. Antares reports file-level localization, so these findings do not prove it understood the intended defects. This is a small single-run fixture check, not an accuracy benchmark or security certification.

The [tracked JSON summary](fastmcp-oauth-summary.json) preserves all six outcomes, counters, and warnings. Its `report` paths are relative to the ignored local directory `reports/fastmcp-oauth-run-1/`, which contains the full raw reports and logs and is not included in a fresh checkout. Initial results predate the runner's added per-investigation wall-clock timeout; none of these six cases was stopped by that timeout.

For the smaller model on the same fixtures, see the [350M comparison](antares-350m.md).

## Reproduce

After following the [fixture environment setup](../examples/fastmcp-oauth/README.md#offline-behavioral-tests), run from the repository root:

```sh
.venv-fastmcp/bin/python examples/fastmcp-oauth/test_fixtures.py
# Start scripts/serve.sh in another terminal if the endpoint is not running.
.venv/bin/python scripts/scan_oauth_examples.py --output reports/my-fastmcp-oauth
```

Use a new output directory for each run. The runner now defaults to a 300-second limit per investigation, configurable with `--timeout`; timeout handling was checked separately with a deliberately tiny limit and correctly recorded exit 124, an incomplete result, and no expected-result judgment. Classification mismatches are recorded separately from operational failures. Model output may vary between runs.
