# Antares script and extension improvement plan

Date: 12 September 2026. Updated: 14 September 2026. Status: implementation delivered in 0.4.0; remaining manual validation gates are listed below.

Implementation status: phases 1–4 and the phase 5 setup commands are implemented. Automated VSCodium validation and all 14 local model/profile runs are recorded in [validation](vscode-extension-validation.md). The visual/keyboard pass, actual setup-UI server-start pass, and execution in VS Code remain pending. Storage uses stable run IDs plus immutable finding indices; the setup/status surface is a command-driven picker. These are the concrete 0.4.0 choices for the proposed UI.

This plan follows the review of extension 0.3.0 and the local scan scripts. It is the current implementation backlog; the [original integration plan](vscode-integration-plan.md) remains historical design context. The review reran all 16 extension unit tests successfully. Live inference and visual editor checks must be performed at the release gates below.

## Outcome and scope

Protect review work, isolate results between projects, export accurate review state, make fixture evaluations resilient, and improve scan coverage without requiring users to know CWE identifiers. Preserve local llama.cpp inference, both Antares models, sequential execution, explicit incomplete results, and VS Code/VSCodium compatibility.

Implement this in five independently reviewable phases. Each phase includes documentation and focused regression tests. Automatic downloads, cloud inference, automatic source fixes, permanent suppressions, and additional operating systems remain outside this work.

| Phase | Priority | Deliverable | Dependency |
| --- | --- | --- | --- |
| 1 | High | Workspace/run storage and durable review drafts | None |
| 2 | High | Freshness checks and reliable export | Phase 1 |
| 3 | Medium | Resilient fixture evaluation and consistent model defaults | Independent of phases 1–2 |
| 4 | Medium | Named scan profiles, coverage display, and failed-category retries | Phases 1–3 |
| 5 | Medium | Setup/status UI and packaged editor validation | Phases 1–4 |

## Phase 1: protect results and review notes

Primary files: `vscode-extension/src/extension.ts`, `review-model.ts`, and `review-panel.ts`. Extract storage and draft handling into small modules to make persistence testable without an editor host.

### Storage

- Replace the single global latest-result file with a versioned store keyed by canonical workspace identity and a unique run ID. Distinguish multi-root workspaces; record the canonical scan target in each run.
- Store each run independently. Derive history from run records rather than relying on an unprotected shared latest pointer. Keep all runs initially; automatic retention/deletion needs a separate policy.
- Use unique temporary files and atomic replacement. Serialize writes within a window and implement cross-window conflict handling for edits to the same run: use an exclusive per-run lock plus revision checking, bounded waiting, and defined stale-lock recovery. A conflicting save must preserve the local draft and offer reload/retry, never silently overwrite another review.
- Migrate the legacy global result only into a matching workspace. Validate its schema, preserve decisions and notes, and leave the original file intact. Make migration idempotent and ensure it never replaces newer data.
- Add a small history picker showing target, model, start time, execution status, and review counts. Starting a scan must not erase earlier decisions.

### Drafts

- Give each finding a stable ID within its run; store draft notes separately from saved review decisions.
- Send draft changes to the extension host and persist them with a debounce. Maintain webview state for immediate restoration, and acknowledge durable saves in the UI.
- Route Explorer navigation, panel navigation, reopening review, and scan-result replacement through the same draft-aware controller. Preserve drafts across panel disposal and normal reload; do not promise recovery of unacknowledged keystrokes after a crash.
- Export durable draft notes separately and label them uncommitted. A draft must never silently become a confirmation or dismissal.
- Disable duplicate save actions while a save is pending and preserve drafts when persistence fails.

Acceptance and tests:

- Type notes, navigate using Explorer and panel controls, close/reopen the panel, and reload the window: acknowledged drafts survive.
- Scan project A, scan project B, then reopen A: its result and decisions remain available.
- Run concurrent writes from two independent store instances: no temporary-file collisions, cross-project overwrites, or silent same-run lost updates.
- Load a legacy result twice: migration preserves all valid review data without duplicating or overwriting it.
- Simulate write/rename failures: the prior durable record remains readable and the UI retains the unsaved draft.

## Phase 2: make freshness and export consistent

Primary files: the review controller/store from phase 1, `review-model.ts`, and the export command.

- Introduce explicit freshness metadata separate from execution and review status: checked time, observed source changes, and the scope of the check.
- Use one refresh path before opening review, saving a decision, and exporting. Hash reviewed candidate files; changed, missing, or unsafe files return to unreviewed while retaining notes. Persist these transitions before presenting/exporting the result.
- Treat dirty editor buffers explicitly: decisions relate to saved source, and export records when unsaved edits exist. Never describe dirty buffers as analyzed source.
- Track saved/renamed/deleted files within the target to mark the run potentially stale. Persist that warning and update an already open review panel without replacing its drafts.
- Do not claim comprehensive dependency freshness. Candidate hashes establish candidate-file freshness only; changes elsewhere may require a rescan. Record this limitation in exported metadata.
- Export a consistent snapshot after pending draft saves and freshness updates finish. Include a schema version, run identity, execution status, review decisions, labeled drafts, and freshness metadata.

Acceptance and tests:

- Confirm a candidate, modify its file externally, and export directly without reopening review: the export marks it unreviewed/stale and retains notes.
- Delete or rename a reviewed file: export remains usable and records the stale decision.
- Editing source while the panel is open updates the warning without losing a draft.
- Reloading preserves stale-state warnings. Unchanged files retain their decisions.

## Phase 3: harden scripts and evaluation

Primary files: `scripts/scan_oauth_examples.py`, `scripts/serve.sh`, `scripts/antares.sh`, and `vscode-extension/src/core.ts`.

### Resilient fixture runner

- Refactor argument parsing and execution behind `main()` and testable functions. Validate finite positive timeouts and deduplicate repeated case/variant selections.
- Validate each report and catch missing, truncated, malformed, and unsupported data per case. Record a bounded error and incomplete status, then continue the batch. Configuration/output-directory failures should still stop before scanning.
- Write the aggregate summary atomically after every case. Preserve case logs and report artifacts for diagnosis.
- Summarize operational completion separately from expected-result accuracy: completed matches, false positives, missed expected paths, incomplete cases, and duration. Do not count incomplete cases as correct negatives or ordinary misses.
- Add an optional `--strict` mode. Preserve default exit semantics (0 when all cases complete, 2 for incomplete/error). In strict mode, return 1 for completed mismatches; incomplete/error takes precedence with exit 2. Document that argument errors can also return 2.
- Include model, endpoint, effective budget, timeout, and available model/runtime revision identifiers so results can be compared meaningfully. Keep unavailable provenance explicit.

### Model defaults

- Define one small model-profile configuration consumed by both shell launchers and the extension, with a documented packaging step for the VSIX.
- Default 1B to port 8082 and 350M to 8086. Preserve explicit `ANTARES_PORT` and endpoint overrides in the CLI wrapper, with explicit endpoint taking precedence there.
- Keep extension endpoints restricted to the configured local profiles. Validate model names consistently and explain missing executable/model files before launching.

Acceptance and tests:

- Inject missing, truncated, wrong-schema, and valid partial reports: later cases still run and summary output remains valid JSON.
- Verify strict/non-strict exit behavior for matches, false positives, misses, and incomplete cases.
- Test launch arguments with a fake executable: selecting only the 350M model uses port 8086; explicit overrides still win. No inference is needed for these tests.
- Re-run the eight existing offline FastMCP fixture/control tests before using those fixtures for quality evaluation.

## Phase 4: improve coverage without requiring CWE knowledge

Primary files: `core.ts`, scan orchestration in `extension.ts`, the review panel, and new versioned profile definitions.

- Add named profiles: **Automatic selection**, **Web application**, and **MCP/OAuth**. Show readable category names; keep identifiers available in details.
- Start the MCP/OAuth profile with authentication (287), missing authorization (862), and confused deputy/token forwarding (441). Start the web profile with SQL injection (89), XSS (79), command injection (78), and path traversal (22). Label these bounded starter profiles, not complete security coverage.
- Verify the installed CLI's explicit multi-category sweep contract before implementation. If it cannot preserve the required per-category results, orchestrate sequential focused queries using the existing interface and aggregate them transparently.
- Show selected, completed, failed, and not-run categories. For automatic selection, explain that relevant categories may be omitted; expose available selection reasons.
- Add **Retry failed categories** using the same target, profile, model, and budgets. Store retries as linked runs so original results and human decisions remain intact. If source changed, identify the new attempt as a different source state.
- Display elapsed time and actual execution stages. Only show per-category live progress if the chosen CLI/orchestration interface provides it; do not fabricate percentages.

Acceptance and tests:

- Request-building tests verify every profile's exact category list, one-worker execution, budget limits, and retained focused-query support.
- The web profile always schedules CWE-89 for the SQL demo. This is a coverage assertion, not a requirement that the model detect the vulnerability.
- The MCP/OAuth profile schedules all three intended categories without asking the user for identifiers.
- Retrying two failed categories schedules only those two and preserves the original run and its reviews.
- Exercise both models against the SQL demo and six OAuth variants using recorded expectations. Publish category coverage, completion, findings, false positives/misses, and duration. Preserve observed failures rather than rerunning until favorable results appear.

## Phase 5: setup UX and release validation

- Add an Antares setup/status view showing CLI path/readiness, selected model, expected endpoint, and server state. Use actionable labels for missing CLI, unreachable server, loading model, and ready server.
- Add an explicit **Start local server** action using a configured/validated POC root and the existing launcher. Track extension-owned processes and report startup failures. Do not infer the POC root from an arbitrary executable or terminate a pre-existing server.
- Retain the copy-command fallback. Do not download weights or install dependencies as a side effect of opening the view.
- Where supported by the pinned server, check loaded-model identity as well as health. Show identity as unverified if it cannot be established; do not treat the requested model label echoed in a report as independent verification.
- Update the root README, extension README, and validation report to match the released behavior. Include storage migration, drafts, export freshness, profile coverage, retry semantics, strict evaluation, and server ownership.

Release gate:

1. Run focused unit/contract tests and the existing suite after each relevant change; keep nondeterministic model quality separate from deterministic product correctness.
2. Package a versioned VSIX and test the packaged artifact in isolated VSCodium and VS Code profiles. Record exact editor versions and avoid altering the user's normal profile.
3. Exercise real navigation and typing: draft recovery, save failures, export after edits, workspace switching, scan cancellation, partial results, retries, and server startup. Host-method tests alone do not validate webview interactions.
4. Perform visual/keyboard checks for narrow panels, long paths, focus order, and status feedback. If UI automation remains unavailable, explicitly record that limitation and require a manual pass before claiming visual validation.
5. Record live results for both models, documented limitations, and the artifact version. Commit each coherent phase and push the completed changes to origin; do not publish to a marketplace as part of this plan.

## Completion criteria

All five reviewed defects have targeted regressions, acknowledged review work survives navigation and project changes, exports reflect checked source state, fixture batches survive individual failures, and scripts/plugin agree on model defaults. Named profiles and retries work without CWE entry. Both editor validation results and model-quality results are documented separately, with any unresolved limitations stated explicitly.
