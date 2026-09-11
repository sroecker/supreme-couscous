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
