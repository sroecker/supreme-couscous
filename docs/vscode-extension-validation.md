# Local editor extension validation

Tested 11 September 2026. Extension: `sroecker.antares-local` 0.1.0. Editor: **VSCodium 1.95.3**, installed at `/Applications/VSCodium.app`, running on local macOS.

## Observed results

- TypeScript compilation passed.
- Seven Node test cases passed: schema/completion handling, fixed profiles and environment filtering, path containment and escaping symlinks, JSON stdin without shell expansion, timeout/cancellation, recorded result handling, and split UTF-8 output.
- `vsce package --no-dependencies` produced a VSIX containing only the manifest, license, README, and two compiled JavaScript modules. No model weights, dependencies, or source-bearing run history are included.
- The VSIX installed successfully through VSCodium's CLI into an isolated profile.
- The packaged extension activated in VSCodium's Extension Development Host. Both local model profiles completed real CWE-89 investigations through the extension's scan service.
- The test verified command registration, candidate-tree item counts, navigation to `app.py`, and opening JSON details.

| Model | Execution | Investigation time | Candidates |
| --- | --- | --- | --- |
| antares-350m | completed | 10.04 s | app.py |
| antares-1b | completed | 24.88 s | app.py |

These durations describe separate model trajectories, not a controlled speed benchmark. Both returned zero generation errors, zero failed workers, and no incomplete reason. The reports still include failed exploration tool calls; completed execution does not establish accuracy beyond this reviewed fixture.

VSIX SHA-256:

```text
d14dfb100d995f705d9ea7de8fae7388370baeae88d4951ffd388906ae94d2e8
```

## Reproduce

Build and package using the [extension README](../vscode-extension/README.md). Start both local servers, then run from the POC root:

```sh
ANTARES_TEST_ROOT="$PWD" /Applications/VSCodium.app/Contents/MacOS/Electron \
  --user-data-dir /tmp/antares-codium-test-profile \
  --extensions-dir /tmp/antares-codium-test-extensions \
  --extensionDevelopmentPath="$PWD/vscode-extension" \
  --extensionTestsPath="$PWD/vscode-extension/test/editor.js" \
  --disable-workspace-trust --skip-welcome --skip-release-notes "$PWD"
```

For package validation, install the VSIX into that isolated extensions directory and set `--extensionDevelopmentPath` to its installed `sroecker.antares-local-0.1.0` directory. The packaged-code test completed with extension-host exit code 0. Raw results are local and ignored at `logs/vscodium-extension-test.json`.

The tests invoke the extension scan service and navigation commands programmatically inside the real editor; they do not automate every interactive prompt or visually inspect the UI. Workspace Trust is disabled only in the isolated test profile. The normal extension manifest and command handlers require trust, but an untrusted-workspace editor test has not yet been run.

## Compatibility and limits

The manifest targets stable VS Code API 1.95 or newer, and the extension uses no Microsoft-specific service. The installed VSCodium 1.95.3 was tested directly; Microsoft VS Code itself and other VSCodium versions were not installed/tested in this session. VSCodium is a distribution of the open-source editor, as described on its [official site](https://vscodium.com/).

This is a local macOS MVP: one manual CWE query, fixed 1B/350M endpoints, cancellation, file candidates, and JSON export. Inference servers are managed separately. Linux/Windows, remote hosts, automatic model download, sweeps, suppression management, comprehensive snapshot freshness, and history restoration are not implemented.

No Cisco IDE scanner is required. Its [architecture research](cisco-ide-scanner-research.md) is retained as background; this extension implements our own Antares CLI/llama.cpp workflow. Original roadmap features beyond this scope remain proposals in the [integration plan](vscode-integration-plan.md).

The test install used an isolated profile, leaving the user's normal VSCodium extensions and settings untouched. Install the local VSIX through **Extensions: Install from VSIX…** to use it in the normal profile.

## Version 0.1.1 usability update

The CLI configuration command now accepts a pasted path, expands `~/`, suggests an executable from an open POC workspace, and validates that the file exists and is executable. Investigations offer named weakness categories with descriptions; entering a numeric CWE is only needed for the custom option.

TypeScript compilation and VSIX packaging passed for 0.1.1. The real VSCodium/model integration results above apply to 0.1.0; these updated input dialogs have not been separately automated in the editor.

## Version 0.2.0 guided review

The review panel opens after a scan and offers candidate selection, source navigation beside the panel, general CWE-specific inspection checklists, notes, Confirm/Dismiss/Unreviewed actions, remaining-review counts, and JSON export with decisions. Dismissal requires a reason. Source is not modified by review actions.

Latest-run restoration supports existing 0.1.x stored results. Decisions persist across reloads and remain separate from investigation completion. Reviewed files are hashed; a changed or missing file reopens its decision when review is opened or restored. Notes are retained. This does not detect all dependency-level changes or provide a full snapshot history.

Validation:

- All 11 unit tests passed, including review transitions, required dismissal reasons, stale-file invalidation, invalid review messages, and HTML escaping.
- VSCodium 1.95.3 integration tests passed for opening a restored run, generating panel content, confirming and dismissing a candidate, source navigation, rejecting missing reasons and messages for an older run, and restoring saved notes/decisions in a second editor process.
- The final 0.2.0 VSIX installed successfully in the isolated profile; its review-action integration test passed with extension-host exit code 0.
- These review tests replay an existing SQL demo result. They do not rerun inference or claim that test-only confirmations/dismissals are security verdicts.
- Desktop automation failed to initialize (`Sky Computer Use native pipe startup failed`), so a visual inspection and real mouse-click pass were not completed. Editor tests exercise the production handlers programmatically and inspect generated panel HTML.

Local test records are in ignored `logs/vscodium-review-test.json` and `logs/vscodium-review-testrestore.json`. Normal user settings and saved review decisions were not changed by these tests.

## Version 0.2.1 CLI failure handling

A user scan failed because its selected 350M inference endpoint was unreachable. The CLI wrote an `InferenceError` to stderr and exited 2 without JSON. The extension discarded stderr and attempted to parse empty stdout, hiding the cause behind `Unexpected end of JSON input`.

The adapter now retains a bounded stderr tail in memory, redacts common credential patterns in displayed diagnostics, and distinguishes empty or malformed output from valid partial JSON. Before scanning, the extension checks the selected local server's health with a three-second timeout. An unavailable server produces a model/port-specific message and a **Copy start command** action. Valid exit-2 reports remain incomplete reports rather than exceptions.

All 14 unit tests passed, including stderr-only failure, malformed output, valid partial results, credential redaction, and unavailable/loading/healthy endpoint checks. TypeScript compilation and 0.2.1 VSIX packaging passed. This update was not separately run inside VSCodium; previous editor validation remains documented above.

After restarting the local 350M server, a real adapter query reached the endpoint and returned valid JSON with exit 2 and the reason `Model submitted no valid repository file paths.` The adapter successfully parsed and classified it as incomplete. This verifies recovery from the connection/parser failure, not a successful security finding. The ignored local record is `logs/extension-recovery.json`.


## Version 0.3.0 automatic sweeps

The plugin now exposes **Antares: Sweep Code Automatically** in the Command Palette, folder context menu, and candidate-view toolbar. Automatic sweep is also the first investigation-picker option. It calls the CLI's JSON `tool sweep` interface with automatic selection, up to three categories by default, and one worker. Category count is configurable from 1–10, with a separate whole-sweep timeout defaulting to 900 seconds.

Review displays per-category results and candidate CWE labels. Its guidance follows the selected candidate's CWE. Focused queries retain their existing behavior. Neither automatic selection nor an empty category result establishes comprehensive security coverage.

All 16 unit tests passed. The VSCodium 1.95.3 integration test ran a real 350M sweep against `examples/demo`, verified command registration, the actual `cwe_sweep` report metadata, three selected categories, candidate-view counts, and review-panel coverage content. The test process exited 0. The initial test assertion expected `sweep` metadata and was corrected to the installed CLI's `cwe_sweep` value before the successful test rerun.

The final model run was **incomplete**, taking 31.26 seconds, with 1 candidates and 2 failed category worker(s). It selected CWE-79, CWE-20, and CWE-78. The extension preserved the partial result and category errors; this is an integration pass, not a successful security assessment. The original SQL injection CWE-89 was not selected in this bounded automatic portfolio.

The local raw record is ignored at `logs/vscodium-sweep-test.json`. TypeScript compilation and 0.3.0 VSIX packaging passed. This release was tested through the Extension Development Host, not by installing its VSIX into the normal user profile.

## Version 0.4.0: persistence, profiles, and setup

Validated 12–14 September 2026. The deterministic extension suite has **27 passing tests**. Five Python runner/launcher tests and all eight offline FastMCP tests pass. The packaged extension ran successfully in the isolated VSCodium 1.95.3 Extension Development Host: legacy migration, run loading, webview flush acknowledgements, persisted drafts, decision saving, and direct export after an external source edit. The export reopened the stale decision and retained its note.

The draft-script test executes the actual generated webview JavaScript against a minimal DOM/editor harness. It covers navigation and an older save acknowledgement arriving after newer keystrokes. Storage tests cover two independent writers, separate workspaces, migration, corrupt records, failed atomic replacement, and known-dead lock recovery. Server tests cover status, root validation, and preserving an independently running server. These checks do not establish model accuracy.

The first packaged run exposed an unchanged panel buffer overwriting a host-side draft. Draft messages now carry dirty state; unchanged buffers only acknowledge flush. Subsequent packaged reliability checks passed.

### Live profile evaluation

The opt-in `vscode-extension/test/profiles-live.js` exercised the same explicit sweep requests used by the extension with both local models. Each model ran Web coverage on the SQL demo and MCP/OAuth coverage on all six fixture/control directories, at tool budget 10, one worker, and a 900-second whole-sweep deadline. The first five 350M runs were retained across the interruption; the remaining nine ran on resumption. No completed result was replaced to improve reported accuracy.

[Machine-readable results](profiles-0.4.0-evaluation.json) include per-category results and available CLI reproducibility metadata. Raw reports remain locally under `logs/profiles-0.4.0`. Timings include CLI overhead and should not be treated as controlled benchmarks.

| Model | Case | Whole sweep | Expected-category paths | Seconds |
| --- | --- | --- | --- | --- |
| antares-350m | sql-demo | incomplete | app.py | 36.8 |
| antares-350m | audience-vulnerable | completed | server.py | 28.9 |
| antares-350m | audience-fixed | completed | server.py | 29.5 |
| antares-350m | token_passthrough-vulnerable | completed | server.py | 25.8 |
| antares-350m | token_passthrough-fixed | completed | server.py | 30.9 |
| antares-350m | tool_scope-vulnerable | completed | server.py | 28.5 |
| antares-350m | tool_scope-fixed | incomplete | server.py | 26.7 |
| antares-1b | sql-demo | completed | app.py | 117.3 |
| antares-1b | audience-vulnerable | incomplete | none | 83.5 |
| antares-1b | audience-fixed | incomplete | none | 77.0 |
| antares-1b | token_passthrough-vulnerable | incomplete | server.py | 77.4 |
| antares-1b | token_passthrough-fixed | completed | server.py | 102.1 |
| antares-1b | tool_scope-vulnerable | completed | server.py | 77.7 |
| antares-1b | tool_scope-fixed | completed | server.py | 77.9 |

The 350M model completed 5/7 sweeps; 1B completed 4/7. The Web profile scheduled CWE-89 for both models and both returned `app.py` for that category. The 350M SQL sweep remained incomplete because a different category failed. Both models produced false positives for fixed OAuth code. Among fully completed sweeps, 350M had three expected-category matches and two mismatches; 1B had two matches and two mismatches. Incomplete sweeps are not counted as correct negatives or ordinary misses, even when they return the expected-category path. The fixture expectations assess the named target CWE, not every other category reported by the model.

### Remaining validation limits

- VS Code is not installed on this machine. Compatibility uses standard APIs targeting editor 1.95+, but this release was executed in VSCodium only.
- Native UI permissions became available, but computer-use selection kept binding to the existing normal-profile VSCodium process rather than the isolated development host. The normal profile's extension and review data were not changed. A visual/keyboard pass on 0.4.0 remains pending; do not interpret the automated host and DOM tests as that pass.
- Local server startup is implemented with explicit ownership, bounded output, cancellation and timeout. Actual llama.cpp processes were separately managed during the 14-run evaluation; the setup UI's full startup path still needs a manual end-to-end pass.
- Dependency freshness is deliberately limited. Hashes cover reviewed candidate files; filesystem/editor events only mark other observed changes potentially stale.

## Version 0.4.1: scan lifecycle and cooperative cleanup

Validated 14 September 2026. **33 extension tests and seven Python tests pass.** The release VSIX includes `runtime/antares_runtime.py`; bytecode/cache files are excluded. `scripts/antares.sh --version` returns `antares-cli 1.0.0` through that launcher. No vendor package files were patched.

The new regressions verify:

- Two simultaneous investigation calls produce one CLI launch, and the scan lock is released after failure. The lock is acquired before awaiting draft flushing.
- A valid completed result is persisted even if the old review draft encounters a revision conflict. The previous panel/draft remains open; the new run is accessible through history.
- Edits during a first scan mark its incoming result stale. A burst of 100 subsequent source-change events produces one freshness save.
- Cancellation and timeout terminate a SIGTERM-ignoring tool in a separate POSIX session, while an unrelated process stays alive. Tests use real Python processes, not a mocked kill function.
- The script runner grants cleanup a two-second grace period on timeout; the launcher preserves JSON stdout and partial-result exit code 2.

The bundled launcher executes the configured Python CLI entry point in its own interpreter and registers subprocess handles created through `subprocess.Popen`. SIGTERM/SIGINT stop new tool starts and terminate registered tools, escalating their process groups after a short grace period. The plugin selects the interpreter from the installed entry point's absolute Python shebang; shell wrappers and env-based shebangs are rejected with an actionable message. This is cooperative cleanup for the pinned CLI's tool-launch mechanism, not an OS sandbox. SIGKILL, OS/editor crashes, or subprocesses created outside that mechanism cannot guarantee cleanup.

The packaged `test/release-editor.js` passed in isolated **VSCodium 1.95.3**, exercising the review workflow and two real CWE-89 investigations through the new launcher:

| Model | Result | Candidate | CLI-reported duration |
| --- | --- | --- | --- |
| Antares 350M | completed | `app.py` | 9.01 seconds |
| Antares 1B | completed | `app.py` | 30.14 seconds |

Logs: `logs/reliability-editor-test.json` and `logs/vscodium-extension-test.json`. Editor exit code was 0. VSCodium emitted its existing update-service/shutdown diagnostics; extension test assertions passed. The broader 0.4.0 profile evaluation remains unchanged, including its false positives and incomplete runs. No new visual/keyboard or VS Code execution claims are made; those previously recorded validation limits remain.


## Version 0.4.2: panel lifetime, workspace changes, and descendant cleanup

- Extension regression tests cover immediate panel closure after typing, batched host-owned draft saves, added/removed/re-added workspace roots and watcher disposal, old history records with revision conflicts, and history selection overlapping scan requests and note edits.
- Python process tests cover a session leader exiting before its child on both normal CLI exit and cancellation. The child is terminated before the leader PID is reaped; existing cancellation tests still verify that unrelated processes survive.
- Review navigation, history loading, and export snapshot creation now reserve the same operation guard used by scans. Save acknowledgements are scoped to the webview render.
- New history uses a stable global `runs/` directory with current-folder filtering. Older workspace-scoped records are read and updated in place, avoiding a copy that could bypass an older window’s revision lock.

The draft tests execute the generated panel script in a simulated DOM. They are not a native keyboard/visual validation. Full keyboard/accessibility checks and testing in Microsoft VS Code remain pending.

Validation on 2026-09-14:

- All **38 extension tests** passed with `ANTARES_TEST_PYTHON=/Users/sroecker/code/antares/.venv/bin/python` (CPython 3.12.14).
- All **9 Python tests** passed under the same interpreter. The process regressions also passed under system Python 3.14 during development.
- Packaged `antares-local-0.4.2.vsix` includes the Python runtime (13 files). Installed into the isolated VSCodium test profile and ran `test/release-editor.js`: review persistence/freshness checks and real scans with both local models passed; editor host exited 0.
- The initial package check exposed missing `os.waitid` on the CLI’s Python 3.12 macOS build. The final runtime uses Darwin libc with the SDK’s `siginfo_t` layout in that case; Native-command testing also exposed Darwin’s `EPERM` response when signaling a zombie-only group; that case now permits normal reaping. Final package validation was repeated after both corrections, with stronger assertions requiring successful repository tools and the known SQL candidate.

The normal VSCodium profile was not updated. Model scan records are in ignored `logs/vscodium-extension-test.json`; review evidence is in `logs/reliability-editor-test.json`.

Final packaged smoke results: antares-350m: completed, app.py returned, 9.5 seconds; antares-1b: completed, app.py returned, 23.8 seconds. Model-generated empty/duplicate commands can still count as failed tool calls; these are distinct from runtime execution failures.
