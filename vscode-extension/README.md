# Antares Local for VS Code and VSCodium

Run local CWE investigations using your installed Antares CLI and llama.cpp server. This independent extension uses standard VS Code APIs and has no Microsoft Marketplace, Copilot, Cisco AI Defense, or cloud-model dependency at runtime.

## Install

Build from the `vscode-extension` directory with Node.js 22:

```sh
npm ci
npm test
npm run package
```

In VS Code or VSCodium, run **Extensions: Install from VSIX…** and select `antares-local-0.2.0.vsix`. Reload if requested. No Marketplace publisher account is needed for a local VSIX.

## Use

Follow the repository setup to install the Antares CLI and convert model weights. Start one of these servers from the repository root in a separate terminal:

```sh
./scripts/serve.sh
# Or:
ANTARES_MODEL=antares-350m ANTARES_PORT=8086 ./scripts/serve.sh
```

1. Open the source workspace and trust it.
2. Run **Antares: Configure Local CLI** and paste the path to this POC's `.venv/bin/antares` executable. Hidden directories work normally, and `~/` is supported. When the POC is an open workspace folder, the installed executable is suggested automatically. The path is validated before saving; use the executable, not `scripts/antares.sh`.
3. Run **Antares: Select Local Model**. 1B uses port 8082; 350M uses 8086.
4. Right-click a target folder and choose **Antares: Investigate CWE**, or use the Command Palette to scan a workspace root.
5. Choose a plain-language weakness category such as **SQL injection** or **Improper authentication**, then confirm the target. The plugin supplies its CWE identifier automatically. **Custom weakness category…** lets you enter another identifier. The scan uses saved files; unsaved edits trigger a save-or-scan-saved-files choice.
6. The **Antares Review** panel opens when the scan finishes. Follow the review workflow below. You can reopen it with **Antares: Review Last Scan** or by clicking a candidate in Explorer.

For the bundled SQL demo, right-click `examples/demo`. For an OAuth variant, select its individual directory, such as `examples/fastmcp-oauth/audience/vulnerable`, to avoid scanning its corrected sibling.

Results are candidate files for human review. They do not include verified source locations or confidence scores. Completed investigations can produce false positives. Incomplete runs stay visibly incomplete; cancellation or failure retains the previous result in the current session.

## Review a scan

1. Select a candidate in **Antares Review**. The header shows scan completion separately from how many candidates remain unreviewed.
2. Click **Open source beside review**. Use the weakness-specific checklist to inspect the source and its relevant callers or middleware. The checklist is general guidance; Antares did not provide a verified vulnerable line or a detailed explanation.
3. Record evidence or context in **Review notes**.
4. Choose **Confirm issue** if your inspection supports the weakness, **Dismiss candidate** if you have a reason it does not apply, or **Save as unreviewed** if more investigation is needed. Dismissal requires a reason. These actions record your assessment; they never edit source code.
5. Use **Next unreviewed** to continue. **Export result and review** includes your decisions and notes alongside the model output.

The latest result and decisions survive reloads in the same editor profile when its target is inside an open workspace. Existing 0.1.x saved results can be restored after updating. Decisions apply to that run, not a permanent suppression rule; new scans start unreviewed. The extension checks reviewed file hashes when restoring or opening review and returns changed/deleted files to unreviewed while retaining notes. Save dirty source files before recording decisions. Changes in dependencies or other files are not comprehensively tracked.

An incomplete investigation remains incomplete even when you have reviewed all returned candidates. Neither an empty result nor a completed review proves the repository is secure.

## Why choose a weakness?

CWE means Common Weakness Enumeration: a standard name and number for a class of software weakness. Antares is trained to locate files relevant to a selected weakness, so each investigation needs a focus. You can select the category without knowing its number. This MVP does not automatically discover every applicable category or run a broad sweep.

## Scope

Version 0.2.0 supports local macOS workspaces, one manual CWE query at a time, and the two fixed loopback model profiles. Settings expose a terminal-call budget (default 10) and wall-clock timeout (default 300 seconds). Cancel from the progress notification. The extension stops its CLI subprocess group, not your inference server.

Remote SSH/containers, browser editors, Windows/Linux execution, sweeps, automatic server/model installation, SARIF export, and permanent suppressions are future work. Original plan milestones beyond this MVP remain proposals.

The extension persists the latest completed/partial result and review decisions under private extension global storage and restores them for the matching workspace. CLI history is also stored there and may contain source excerpts. There is no extension telemetry. Source paths and text go to the selected localhost inference server through Antares. `.antares.toml` controls exclusions; `.gitignore` is not automatically applied. No MCP servers or fixture applications are started.

Model/server processes remain separately managed. The extension does not download weights or silently switch endpoints. Saved-file changes observed in the editor mark displayed results potentially stale; comprehensive disk/hash tracking is not implemented in this MVP.

## Validation

`npm test` checks report parsing, incomplete execution, path containment and escaping symlinks, subprocess stdin handling, timeout/cancellation, local profiles, environment filtering, and recorded report handling.

`test/editor.js` runs inside an actual editor Extension Development Host. It activates the extension, checks command registration, invokes its scan service against both models, checks candidate rendering/navigation, and opens JSON details. It requires both local endpoints and `ANTARES_TEST_ROOT` pointing to the POC. It is excluded from the VSIX.

The editor test uses an isolated user-data directory and disables Workspace Trust only in that test profile. Normal installations require a trusted workspace. See the repository's extension validation report for observed editor/version and run results.

## License

MIT. The installed Antares CLI, llama.cpp, and model weights retain their own licenses and are not included in the extension package.
