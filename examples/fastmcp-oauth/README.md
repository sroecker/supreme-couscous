# FastMCP OAuth security fixtures

Three application-level mistakes, each paired with a corrected control, for testing Antares vulnerability localization. These are deliberately small **source-inspection fixtures**, not deployable OAuth services and not claims of vulnerabilities in FastMCP itself.

The examples use FastMCP **3.4.7** as an OAuth resource server: it validates bearer tokens issued elsewhere. Full authorization-server discovery, login, consent, redirect handling, PKCE, and refresh-token flows are outside their scope. No fixture calls `mcp.run()`. All service URLs use reserved `.invalid` domains, keys are supplied by the caller, and the tests create signing keys in memory.

## Cases and expected outcomes

Scan each individual variant directory so Antares cannot read its corrected sibling, this README, the tests, or the case descriptions. The only source file in a target is `server.py`.

| Case | Focused CWE | Deliberate mistake | Corrected control |
| --- | --- | --- | --- |
| [Audience](audience/vulnerable/server.py) | CWE-287, Improper Authentication | `JWTVerifier` verifies the signature, issuer, expiry, and baseline scope, but omits the expected audience. A valid token issued for another resource is accepted. | [Fixed](audience/fixed/server.py): set the exact MCP resource audience. |
| [Token passthrough](token_passthrough/vulnerable/server.py) | CWE-441, Unintended Proxy or Intermediary | The tool copies `get_access_token().token` into an upstream API's Authorization header. | [Fixed](token_passthrough/fixed/server.py): obtain a separate, resource-bound upstream credential with the server's client credentials. |
| [Tool scope](tool_scope/vulnerable/server.py) | CWE-862, Missing Authorization | Any caller meeting the baseline `reports:read` scope can export privileged audit data. | [Fixed](tool_scope/fixed/server.py): require `audit:export` inside the tool and reject missing authentication context. |

Expected file-level result for the focused CWE: `server.py` for a vulnerable variant, no findings for its fixed control. These CWE mappings are useful test categories, not a claim that every OAuth mistake has a unique CWE mapping. A corrected control fixes the specified mistake; it is not a complete production security design.

### Token-passthrough boundary

The downstream operation is a synthetic global project count deliberately authorized for MCP callers with `projects:read`. The fixed example uses the client-credentials grant for that service operation, requests a downstream resource and scope, and never forwards the MCP token. A production identity provider must support those parameters and grant the appropriate limited access.

This is not a delegated per-user access pattern. A real API requiring user-specific permissions would need a properly authorized token-exchange/delegation design plus user and tenant authorization. The offline test verifies credential separation, not a real identity provider's policy. The vulnerable example demonstrates a prohibited token-boundary crossing; a correctly configured downstream API should reject that wrong-audience token.

## Offline behavioral tests

From the repository root, create a separate environment so FastMCP dependencies do not affect Antares:

```sh
uv venv --python 3.12 .venv-fastmcp
uv pip install --python .venv-fastmcp/bin/python -r examples/fastmcp-oauth/requirements.txt
.venv-fastmcp/bin/python examples/fastmcp-oauth/test_fixtures.py
```

Eight test methods cover:

- Wrong and absent audience accepted only in the deliberately misconfigured verifier.
- Correct audience accepted by both variants.
- Expired tokens and signatures from the wrong key rejected by both variants.
- Baseline-only scope denied by the corrected audit tool, with explicit export scope allowed.
- Missing access-token context rejected by the corrected audit tool.
- Incoming MCP token forwarded only by the vulnerable proxy; the control sends a separate upstream token.

The tests instantiate the real FastMCP classes, sign JWTs with temporary RSA keys, and exercise real JWT verification. Tool callbacks run with a mocked authentication context. All downstream HTTP calls use `httpx.MockTransport`. No listeners, external requests, or persistent credentials are created. This validates the selected behaviors, not the complete HTTP authentication middleware or OAuth discovery flow.

## Antares scans

Start the normal BF16 GPU endpoint with `./scripts/serve.sh` if it is not already running. Then scan the six targets sequentially:

```sh
.venv/bin/python scripts/scan_oauth_examples.py --output reports/my-fastmcp-oauth
```

Or select a single pair or variant:

```sh
.venv/bin/python scripts/scan_oauth_examples.py \
  --case audience --output reports/my-audience-pair
.venv/bin/python scripts/scan_oauth_examples.py \
  --case tool_scope --variant fixed --output reports/my-scope-control
```

Repeat `--case` or `--variant` to select multiple values. Each run uses the configured local endpoint, the case's CWE, and a terminal-call budget of 10. The model receives the standard CWE prompt, without a custom hint identifying the expected defect. The report directory must be new and outside the fixtures. A 300-second wall-clock limit applies to each investigation; use `--timeout` to change it. Timed-out cases are recorded as incomplete with exit code 124, and the runner continues to the remaining cases.

Outputs include `summary.json` plus `report.json`, `report.md`, `report.sarif`, and `run.log` under `<case>/<variant>/`. The runner writes the summary after each result. It exits 2 if any scan is operationally incomplete; a mismatch with expected findings is recorded rather than treated as an execution failure.

Interpret `matches_expected` only when `complete` is true. A complete scan can still miss the mistake or flag a corrected control. The offline tests establish fixture behavior independently of model output. The [recorded Antares results](../../reports/fastmcp-oauth.md) summarize the initial run; detailed rerun artifacts remain local and ignored by Git.

## Sources

- [FastMCP token verification](https://gofastmcp.com/servers/auth/token-verification): verifier configuration and the resource-server boundary.
- Installed FastMCP 3.4.7 `fastmcp/server/auth/providers/jwt.py`: audience-validation behavior was checked against the installed source and the offline tests.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): resource-bound access tokens.
- [MCP security best practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices): audience validation and prohibition of token passthrough.
