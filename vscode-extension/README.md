# Antares Local for VS Code and VSCodium

Run local security investigations with the installed Antares CLI and llama.cpp. Version 0.4.2 includes scan profiles, automatic draft saving, workspace run history, freshness checks before export, and explicit local server startup. No Marketplace, Copilot, Cisco AI Defense, or cloud-model service is required at runtime.

## Install and connect

Build with Node.js 22 from this directory:

```sh
npm ci
npm test
npm run package
```

Run **Extensions: Install from VSIX…**, select `antares-local-0.4.2.vsix`, and reload if requested. The extension uses standard editor APIs and supports local trusted macOS workspaces. See [validation](../docs/vscode-extension-validation.md) for exact tested versions.

1. Complete the repository setup to install the CLI and convert weights.
2. Open the source workspace and trust it.
3. Run **Antares: Configure Local CLI**. Paste the absolute path to this POC's `.venv/bin/antares`; hidden directories and `~/` work. Use the executable, not `scripts/antares.sh`.
4. Run **Antares: Select Local Model** to choose 1B or 350M.
5. Open **Antares: Setup and Server Status** to check CLI configuration and server availability. Select **Start local server** and supply the POC folder if you want the extension to launch the existing server script. No dependencies or weights are downloaded. The CLI must be the installed Python entry point with an absolute Python shebang; the extension uses that interpreter to run its bundled cleanup launcher.

You can also keep a separately managed server running from the POC root:

```sh
./scripts/serve.sh
# Or, with its model-specific default port:
ANTARES_MODEL=antares-350m ./scripts/serve.sh
```

1B defaults to port 8082 and 350M to 8086. The shell wrappers and extension consume the same model-profile JSON. Shell `ANTARES_PORT` overrides the default; `ANTARES_ENDPOINT` takes precedence for CLI requests. The extension uses fixed loopback endpoints.

The startup command validates `antares.pocRoot` before executing its launcher. An extension-started server is owned by that editor and stopped when the extension shuts down normally. Existing servers remain independently managed. Startup is cancellable, has a 60-second readiness deadline, and writes bounded output to **Antares Server**. A server-advertised model alias is not independent verification of loaded weights. Abrupt editor termination may require manual process cleanup.

## Scan code

Right-click a source folder and select **Antares: Sweep Code**, then choose coverage:

| Profile | Scheduled checks |
| --- | --- |
| Automatic selection | Up to the configured number of repository-selected categories; default 3. |
| Web application | SQL injection (89), XSS (79), command injection (78), path traversal (22). |
| MCP/OAuth | Authentication (287), missing authorization (862), confused deputy/token forwarding (441). |

These are bounded starting profiles, not complete security coverage. A category being scheduled does not mean the model successfully investigated it. The Web profile always includes SQL injection; automatic selection can omit it.

For the SQL fixture, select `examples/demo`. For OAuth, select an individual variant such as `examples/fastmcp-oauth/audience/vulnerable`, so corrected and vulnerable siblings are not mixed. **Antares: Investigate CWE** still offers focused named checks and custom identifiers. CWE is the Common Weakness Enumeration label for a class of weakness; using a scan profile requires no CWE entry.

The plugin scans saved files. Dirty target files trigger a save-or-scan-saved-files choice. Sweeps use `antares tool sweep --stdin` with one worker. Named profiles pass explicit category lists; automatic selection uses the CLI selector. Progress displays stages and elapsed time, not an invented percentage. Cancellation or timeout asks the bundled Python launcher to stop the CLI’s registered tool processes, including tools in separate POSIX sessions, before the outer runner forces CLI termination if needed. Prior results are retained. This requires cooperative SIGTERM handling; abrupt SIGKILL or an editor/OS crash cannot guarantee cleanup. A cancelled CLI may not have emitted partial JSON. On macOS, the runtime inspects tool exit with `waitid(WNOWAIT)` (via Darwin libc on Python 3.12 builds without `os.waitid`) and kills any remaining group members before reaping the leader, so it never retains an exited leader’s numeric process-group ID for later signaling. Tool children must not outlive their tool command. The runtime hooks CPython subprocess polling/waiting; test this integration when changing Python versions.

## Review and retry

Each completed or partial result is saved before switching the review panel. If the previous draft conflicts or the panel does not respond, the new result remains available in Run History and the previous review stays open. Scans, review navigation, history loading, and export snapshot creation share an operation guard. History flushes notes again before switching to the selected run. The review panel opens after a completed or partial result. Execution status is separate from review decisions.

1. Select a candidate and **Open source beside review**.
2. Inspect the file and relevant callers or middleware using the general checklist. Antares supplies file-level candidates, without verified lines or detailed vulnerability explanations.
3. Type review notes. Each edit is sent immediately to extension memory; disk writes are batched over 150 ms. Closing and reopening the review panel retains delivered edits. Wait for **Draft saved** before closing the editor. Navigation and export request a final draft acknowledgement. Unacknowledged keystrokes are not guaranteed to survive abrupt shutdown.
4. **Confirm issue**, **Dismiss candidate**, or **Save as unreviewed** records your assessment. Dismissal requires a reason. Saving a decision consumes that candidate's draft. These actions do not change source code.
5. Use **Next unreviewed** or select another candidate. Explorer navigation also preserves acknowledged drafts.

The category list distinguishes candidate counts from category errors. **Retry failed categories** creates a linked run for only the failed categories, retaining the original results and decisions. It reuses the recorded model, budget, timeout, and target; save dirty files before retrying. The new attempt scans the current saved source, not an archived snapshot. Retried findings start unreviewed. A result remains incomplete even if every returned candidate has a human decision.

Model candidates are not verified vulnerabilities. Neither a completed empty scan nor a completed human review proves the repository secure. Recorded evaluations include false positives and incomplete investigations.

## History, freshness, and export

**Antares: Run History** lists scans for the current canonical set of workspace folders. Records include target, time, model, scan status, and review counts. Each run has an independent ID; its finding indices remain stable within that immutable report. New scans retain older results. Adding or removing folders immediately updates history filtering and filesystem watchers. Removing a folder hides its runs without deleting them; adding it again restores access, including after restarting the editor.

New records live in private extension global storage under `runs/`, filtered by the currently open folders. Older `workspaces/<workspace-hash>/runs/` records remain readable and editable in place, retaining their original revision locks. Records use schema version 2, atomic replacement, revision checks, and per-run process locks. Concurrent conflicting saves do not silently overwrite data. Open Run History after a conflict: the local draft is retained as a separate recovery run before loading a saved version. The legacy `last-result.json` is migrated idempotently into matching workspaces and left untouched. Corrupt run files stay on disk for recovery and do not hide other valid history. No automatic history pruning occurs.

Known-dead process locks are reclaimed automatically. An empty lock or interrupted reclamation can require recovery: close all editor instances first, back up the storage directory, and remove only the affected `.lock`/`.lock.reclaim` files before reopening. Never remove a live writer's lock or the run JSON as a recovery step.

Edits observed during inference mark the incoming run potentially stale, including the first scan. Repeated source-change events persist the transition to stale once rather than rewriting the full report for every keystroke. Opening review, recording decisions, and exporting check reviewed candidate-file hashes. Changed, missing, or unsafe files return to unreviewed with their notes retained. Observed source edits/renames/deletions mark results potentially stale and persist that warning. Dependency changes are not comprehensively tracked; a rescan is needed to refresh the investigation itself.

**Export result and review** flushes drafts and checks freshness before creating a snapshot. JSON includes execution state, decisions, drafts explicitly separate from decisions, the check timestamp/scope, and dirty-file paths. Draft notes never silently become confirmed or dismissed decisions. The snapshot represents the check time; edits after that time require another export or scan.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `antares.cliPath` | Empty | Installed executable path. |
| `antares.pocRoot` | Empty | POC folder for explicit server startup. |
| `antares.model` | `antares-1b` | Local model profile. |
| `antares.toolBudget` | 10 | Terminal-call budget per category, 1–50. |
| `antares.timeoutSeconds` | 300 | Focused-query deadline, up to 1,800 seconds. |
| `antares.sweepTimeoutSeconds` | 900 | Entire sweep deadline, up to 3,600 seconds. |
| `antares.sweepMaxCwes` | 3 | Automatic-selection limit, 1–10; named profiles have explicit lists. |

`.antares.toml` controls exclusions; `.gitignore` is not automatically applied. CLI history may contain source excerpts. Model requests stay on the selected loopback endpoint; the extension has no telemetry. No MCP servers or fixture applications are started. Linux/Windows execution, remote workspaces, SARIF export, permanent suppressions, and automatic remediation remain outside this release.

## Development checks

`npm test` requires Python 3 for the subprocess cleanup tests (`ANTARES_TEST_PYTHON` can select its absolute path) and runs deterministic process, schema, storage/conflict, draft-script, freshness, profile, and server-status tests. `test/reliability-editor.js` exercises the packaged extension and its real webview messaging in an isolated VSCodium host. `test/profiles-live.js` is an opt-in local evaluation across both models, the SQL demo, and six OAuth variants; it resumes existing results under `logs/profiles-0.4.0` rather than replacing them. Move that evaluation directory aside before deliberately starting a new experiment.

From the repository root, `python3 -m unittest discover -s tests -v` checks the fixture runner and shell defaults. The separate FastMCP environment runs `examples/fastmcp-oauth/test_fixtures.py`. See the [validation report](../docs/vscode-extension-validation.md) for observed results and remaining manual checks.

## License

MIT. Antares CLI, llama.cpp, and model weights retain their own licenses and are not included in the VSIX.
