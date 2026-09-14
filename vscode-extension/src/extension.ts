import * as vscode from 'vscode';
import { LocalServers, serverStatus, validatePocRoot } from './server';
import { access, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { RunStore, ConflictError } from './store';
import { constants } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { counts, decision, invalidateDecision, nextPending, reviewSummary, ReviewStatus, Run, setDecision } from './review-model';
import { ReviewMessage, ReviewPanel, reviewHtml, runKey } from './review-panel';
import { candidatePath, checkServer, childEnvironment, cliReport, inside, isComplete, LocalServerError, profile, runCli, scanRequest, scanProfiles, explicitSweepRequest, failedCategories } from './core';
import { Candidates } from './candidates';
let active: AbortController | undefined;
export function deactivate() { active?.abort(); }
export async function activate(context: vscode.ExtensionContext) {
  const servers = new LocalServers();
  const serverOutput = vscode.window.createOutputChannel('Antares Server');
  context.subscriptions.push(servers, serverOutput);
  const candidates = new Candidates();
  context.subscriptions.push(candidates, vscode.window.registerTreeDataProvider('antares.candidates', candidates));
  let workspaceRoots = await Promise.all((vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => realpath(f.uri.fsPath)));
  const store = new RunStore(context.globalStorageUri.fsPath, workspaceRoots);
  let last: Run | undefined;
  let savingReview = false;
  const deferredChanges = new Set<string>();
  const review = new ReviewPanel(handleReviewMessage);
  context.subscriptions.push(review);
  const unsavedRuns = new WeakSet<Run>();
  let writes: Promise<unknown> = Promise.resolve();
  function persist(run: Run) {
    const pending = writes.then(() => store.save(run)).then(() => { unsavedRuns.delete(run); }, error => { unsavedRuns.add(run); throw error; });
    writes = pending.catch(() => {});
    return pending;
  }
  const failedDrafts = new Map<Run, unknown>();
  const draftSaves = new Map<Run, Promise<void>>();
  async function flushDrafts() {
    await review.flush();
    await Promise.all([...draftSaves.values()]);
    await writes;
    if (last && failedDrafts.has(last)) {
      const error = failedDrafts.get(last);
      if (error instanceof ConflictError) throw error;
      throw new Error(`Draft is still unsaved: ${error instanceof Error ? error.message : String(error)}. Run Antares: Retry Draft Save after resolving the storage problem.`);
    }
  }
  async function saveDraft(index: number, note: string) {
    if (!last?.report?.findings[index] || typeof note !== 'string' || note.length > 4000) throw new Error('Invalid draft.');
    const run = last;
    run.drafts ??= {};
    run.drafts[String(index)] = { note, updated: new Date().toISOString() };
    // Text belongs to the extension immediately; only disk writes are batched.
    let pending = draftSaves.get(run);
    if (!pending) {
      pending = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          draftSaves.delete(run);
          void persist(run).then(() => { failedDrafts.delete(run); resolve(); }, error => { failedDrafts.set(run, error); reject(error); });
        }, 150);
      });
      draftSaves.set(run, pending);
    }
    await pending;
  }
  function refresh() {
    if (last) candidates.update(`${last.sourceChanged ? 'Source changed · ' : ''}${last.status} · ${reviewSummary(last)}`, last);
  }
  async function sourceHash(run: Run, index: number) {
    const file = await candidatePath(run.target, run.report!.findings[index].file_path);
    return createHash('sha256').update(await readFile(file)).digest('hex');
  }
  async function refreshDecisions(run: Run) {
    let changed = false;
    for (let index = 0; index < (run.report?.findings.length ?? 0); index++) {
      if (decision(run, index).status === 'unreviewed') continue;
      let hash: string | undefined;
      try { hash = await sourceHash(run, index); } catch { /* Missing or unsafe files require review. */ }
      changed = invalidateDecision(run, index, hash) || changed;
    }
    return changed;
  }
  async function saveDecision(index: number, status: ReviewStatus, note: string) {
    supported();
    if (busy || savingReview || !last) throw new Error('Wait for the current operation to finish.');
    savingReview = true;
    try {
      await writes;
      const run: Run = structuredClone(last);
      await refreshDecisions(run);
      const finding = run.report?.findings[index];
      if (!finding) throw new Error('Unknown candidate.');
      const file = await candidatePath(run.target, finding.file_path);
      if (vscode.workspace.textDocuments.some(d => d.uri.fsPath === file && d.isDirty)) throw new Error('Save the source file before recording a review decision.');
      const hash = await sourceHash(run, index);
      setDecision(run, index, status, note, hash);
      delete run.drafts?.[String(index)];
      await persist(run);
      last = run;
      refresh();
      review.show(run, index, status === 'unreviewed' ? 'Notes saved. This candidate remains to review.' : `Decision saved. ${counts(run).unreviewed ? 'Continue with Next unreviewed.' : 'All candidates have a review decision.'}`);
    } finally { savingReview = false; for (const file of deferredChanges) markChanged(file); deferredChanges.clear(); }
  }
  async function handleReviewMessage(message: ReviewMessage) {
    if (!message || typeof message.action !== 'string' || !last || message.run !== runKey(last)) throw new Error('This review belongs to an older run. Open the latest result.');
    if (!Number.isInteger(message.index) || message.index < 0) throw new Error('Invalid candidate.');
    if (['select', 'open', 'decide', 'next', 'draft'].includes(message.action) && !last.report?.findings[message.index]) throw new Error('Unknown candidate.');
    switch (message.action) {
      case 'draft': await saveDraft(message.index, message.note as string); break;
      case 'select': await showReview(message.index); break;
      case 'open': await vscode.commands.executeCommand('antares.openCandidate', last.target, last.report!.findings[message.index].file_path); break;
      case 'decide': await saveDecision(message.index, message.status as ReviewStatus, message.note as string); break;
      case 'next': await showReview(nextPending(last, message.index)); break;
      case 'export': await vscode.commands.executeCommand('antares.export'); break;
      case 'retry': await vscode.commands.executeCommand('antares.retry'); break;
      case 'raw': await vscode.commands.executeCommand('antares.details'); break;
      default: throw new Error('Unknown review action.');
    }
  }
  async function reviewOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (busy || savingReview) throw new Error('Wait for the current operation to finish.');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  }
  async function showReview(index = 0) {
    return reviewOperation(async () => {
      if (!last) throw new Error('Run an investigation first.');
      await prepareSnapshotUnlocked(false);
      refresh(); review.show(last, index);
    });
  }
  const config = () => vscode.workspace.getConfiguration('antares');
  const supported = () => {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Antares.');
    if (process.platform !== 'darwin' || vscode.env.remoteName) throw new Error('This MVP supports local macOS workspaces.');
  };
  const register = (name: string, handler: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(name, async (...args: any[]) => {
      try { return await handler(...args); } catch (error) {
        if (error instanceof LocalServerError) {
          const action = await vscode.window.showErrorMessage(error.message, 'Copy start command');
          if (action) {
            await vscode.env.clipboard.writeText(error.startCommand);
            void vscode.window.showInformationMessage('Start command copied. Run it from your Antares project folder and keep that terminal open.');
          }
        } else void vscode.window.showErrorMessage(`Antares: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  };
  register('antares.configure', async () => {
    supported();
    let suggested = config().get<string>('cliPath', '');
    if (!suggested) {
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (folder.uri.scheme !== 'file') continue;
        const candidate = path.join(folder.uri.fsPath, '.venv', 'bin', 'antares');
        try {
          if ((await stat(candidate)).isFile()) {
            await access(candidate, constants.X_OK);
            suggested = candidate;
            break;
          }
        } catch { /* Try the next workspace folder. */ }
      }
    }
    const normalize = (value: string) => value.trim().startsWith('~/')
      ? path.join(homedir(), value.trim().slice(2)) : value.trim();
    const selection = await vscode.window.showInputBox({
      title: 'Configure Antares CLI',
      prompt: 'Paste the path to .venv/bin/antares. Hidden directories and ~/ paths are supported.',
      placeHolder: '/path/to/antares/.venv/bin/antares',
      value: suggested,
      ignoreFocusOut: true,
      validateInput: async value => {
        const executable = normalize(value);
        if (!path.isAbsolute(executable)) return 'Enter an absolute path or a path starting with ~/.';
        try {
          if (!(await stat(executable)).isFile()) return 'The path must point to an executable file.';
          await access(executable, constants.X_OK);
          return null;
        } catch { return 'File not found or not executable. Select the installed .venv/bin/antares.'; }
      }
    });
    if (selection !== undefined) {
      await config().update('cliPath', normalize(selection), vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage('Antares CLI path saved.');
    }
  });
  register('antares.startServer', async () => {
    supported();
    const model = config().get<string>('model', 'antares-1b');
    let root = config().get<string>('pocRoot', '');
    if (!root) {
      const entered = await vscode.window.showInputBox({ title: 'Antares POC folder', prompt: 'Paste the absolute folder containing scripts/serve.sh and your models. This launcher will be executed.', value: workspaceRoots.find(r => path.basename(r) === 'antares') ?? '', ignoreFocusOut: true });
      if (!entered) return;
      root = await validatePocRoot(entered.trim().replace(/^~(?=\/)/, homedir()), model);
      await config().update('pocRoot', root, vscode.ConfigurationTarget.Global);
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Starting local ${model}`, cancellable: true }, async (_progress, token) => {
      const abort = new AbortController(), cancel = token.onCancellationRequested(() => abort.abort());
      try {
        serverOutput.clear();
        let outputBytes = 0;
        const message = await servers.start(root, model, path.join(context.globalStorageUri.fsPath, 'cli-history'), chunk => { outputBytes += chunk.length; if (outputBytes > 1000000) { serverOutput.clear(); outputBytes = chunk.length; } serverOutput.append(chunk); }, abort.signal);
        void vscode.window.showInformationMessage(message);
      } catch (error) { serverOutput.show(true); throw error; } finally { cancel.dispose(); }
    });
  });
  register('antares.status', async () => {
    supported();
    const model = config().get<string>('model', 'antares-1b'), executable = config().get<string>('cliPath', '');
    let cli = 'Not configured or executable missing';
    try { if (path.isAbsolute(executable) && (await stat(executable)).isFile()) { await access(executable, constants.X_OK); cli = executable; } } catch { /* Show setup action. */ }
    const state = await serverStatus(model);
    const chosen = await vscode.window.showQuickPick([
      { label: 'CLI', description: cli, command: 'antares.configure' },
      { label: 'Model', description: `${model} · ${profile(model).endpoint}`, command: 'antares.selectModel' },
      { label: 'Server', detail: state.description, command: state.ready ? 'antares.status' : 'antares.startServer' },
      { label: 'Start local server', description: config().get<string>('pocRoot') || 'Configure POC folder on first start', command: 'antares.startServer' },
      { label: 'Run history', description: 'Saved scans, review decisions and drafts for this workspace', command: 'antares.history' }
    ], { title: 'Antares Setup and Server Status', matchOnDetail: true });
    if (chosen) await vscode.commands.executeCommand(chosen.command);
  });
  register('antares.selectModel', async () => {
    const choice = await vscode.window.showQuickPick(['antares-1b', 'antares-350m'], { title: 'Select a running local model' });
    if (choice) await config().update('model', choice, vscode.ConfigurationTarget.Global);
  });
  let busy = false;
  let scanning: { target: string; sourceChanged: boolean } | undefined;
  async function investigate(targetUri: vscode.Uri, cwe?: string, options?: {categories?: string[]; label?: string; parent?: Run}): Promise<Run> {
    if (busy || savingReview) throw new Error('An investigation or review save is already running.');
    busy = true;
    try {
      await flushDrafts();
      return await performInvestigation(targetUri, cwe, options);
    } finally { busy = false; scanning = undefined; syncWatchers(); }
  }
  async function performInvestigation(targetUri: vscode.Uri, cwe?: string, options?: {categories?: string[]; label?: string; parent?: Run}): Promise<Run> {
    supported();
    if (active) throw new Error('An investigation is already running.');
    if (targetUri.scheme !== 'file') throw new Error('Select a local folder.');
    const target = await realpath(targetUri.fsPath);
    const roots = await Promise.all((vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => realpath(f.uri.fsPath)));
    if (!roots.some(root => inside(root, target)) || !(await stat(target)).isDirectory()) throw new Error('Choose a directory within the open workspace.');
    scanning = { target, sourceChanged: false };
    syncWatchers();
    const executable = config().get<string>('cliPath', '');
    if (!path.isAbsolute(executable)) throw new Error('Run Antares: Configure Local CLI first.');
    await access(executable, constants.X_OK);
    const connection = profile(options?.parent?.model ?? config().get<string>('model', 'antares-1b'));
    await checkServer(connection);
    const sweep = cwe === undefined;
    const label = options?.label ?? cwe ?? 'Automatic sweep';
    const budget = options?.parent?.toolBudget ?? config().get<number>('toolBudget', 10);
    const seconds = options?.parent?.timeoutSeconds ?? (sweep ? config().get<number>('sweepTimeoutSeconds', 900) : config().get<number>('timeoutSeconds', 300));
    const request = options?.categories ? explicitSweepRequest(target, connection, budget, options.categories) : scanRequest(target, connection, budget, cwe, config().get<number>('sweepMaxCwes', 3));
    if (!Number.isInteger(budget) || budget < 1 || budget > 50 || !Number.isInteger(seconds) || seconds < 1 || seconds > (sweep ? 3600 : 1800)) throw new Error('Invalid tool budget or timeout.');
    const storage = context.globalStorageUri.fsPath;
    await mkdir(storage, { recursive: true, mode: 0o700 });
    if (inside(target, await realpath(storage))) throw new Error('Extension storage must be outside the target.');
    const history = path.join(storage, 'cli-history');
    await mkdir(history, { recursive: true, mode: 0o700 });
    const started = new Date().toISOString();
    const abort = new AbortController(); active = abort;
    candidates.update(`Running ${label} · ${connection.model}`, last);
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Antares ${connection.model}: ${label}`, cancellable: true }, async (progress, token) => {
        const cancel = token.onCancellationRequested(() => abort.abort());
        const progressStart = Date.now();
        const elapsed = setInterval(() => progress.report({ message: `Investigating saved source · ${Math.floor((Date.now() - progressStart) / 1000)}s elapsed` }), 1000);
        try {
          progress.report({ message: sweep ? 'Selecting weakness categories and investigating them sequentially…' : 'Investigating saved source files…' });
          const result = await runCli(executable, ['tool', request.mode, '--stdin'], request.payload, storage, childEnvironment(history), seconds * 1000, abort.signal, path.join(__dirname, '..', 'runtime', 'antares_runtime.py'));
          const run: Run = { sourceChanged: scanning?.sourceChanged || undefined, toolBudget: budget, timeoutSeconds: seconds, scanProfile: label, categories: options?.categories, parentRunId: options?.parent?.id, target, model: connection.model, cwe: label, mode: sweep ? 'sweep' : 'query', started, finished: new Date().toISOString(), status: result.stopped ?? 'failed' };
          if (!result.stopped) {
            run.report = cliReport(result);
            if (run.report.metadata.model !== connection.model) throw new Error('Result model does not match selected model.');
            const missing = (options?.categories ?? []).filter(id => !run.report!.per_cwe_results?.some(r => r.cwe_id === id));
            if (missing.length) run.report.warnings = [...(run.report.warnings ?? []), `No category result returned for: ${missing.join(', ')}`];
            run.status = isComplete(run.report, result.exitCode) ? 'completed' : 'incomplete';
          }
          if (result.stopped) candidates.update(`${run.status}; previous result retained`, last);
          else {
            // Save successful work even when the previous panel cannot release its draft.
            await persist(run);
            try { await flushDrafts(); } catch (error) {
              candidates.update(`${run.status} scan saved to Run History; previous review retained`, last);
              void vscode.window.showWarningMessage(`Antares saved the new scan to Run History, but kept your previous review open: ${error instanceof Error ? error.message : String(error)}`);
              return run;
            }
            last = run;
            refresh();
            syncWatchers();
            review.show(run);
          }
          return run;
        } finally { clearInterval(elapsed); cancel.dispose(); }
      });
    } catch (error) { candidates.update('Investigation failed; previous result retained', last); throw error; }
    finally { if (active === abort) active = undefined; }
  }
  async function startSweep(uri?: vscode.Uri, selected?: keyof typeof scanProfiles) {
    supported();
    if (!uri) {
      const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select a folder to sweep' });
      if (!folder) return; uri = folder.uri;
    }
    if (vscode.workspace.textDocuments.some(d => d.isDirty && d.uri.scheme === 'file' && inside(uri!.fsPath, d.uri.fsPath))) {
      const choice = await vscode.window.showWarningMessage('The sweep scans saved files. Some target files have unsaved changes.', { modal: true }, 'Save All', 'Scan Saved Files');
      if (!choice || (choice === 'Save All' && !await vscode.workspace.saveAll())) return;
    }
    const picked = selected ? { key: selected, ...scanProfiles[selected] } : await vscode.window.showQuickPick(Object.entries(scanProfiles).map(([key, value]) => ({ key, ...value, label: value.name, description: value.categories?.join(', ') ?? 'Up to the configured number of categories' })), { title: 'Choose scan coverage' });
    if (!picked) return;
    const coverage = picked.categories ? picked.categories.join(', ') : `up to ${config().get('sweepMaxCwes', 3)} automatically selected categories`;
    const confirm = await vscode.window.showInformationMessage(`Sweep ${uri.fsPath} using local ${config().get('model')}? ${picked.name}: ${coverage}. Categories run one at a time; this is bounded coverage.`, { modal: true }, 'Start sweep');
    if (confirm) await investigate(uri, undefined, { categories: picked.categories, label: picked.name });
  }
  register('antares.sweep', (uri?: vscode.Uri) => startSweep(uri));
  register('antares.retry', async () => {
    if (!last?.report) throw new Error('No run to retry.');
    const parent = structuredClone(last), categories = failedCategories(parent.report!, parent.categories);
    if (!categories.length) throw new Error('This run has no failed categories to retry.');
    if (vscode.workspace.textDocuments.some(d => d.isDirty && inside(parent.target, d.uri.fsPath))) throw new Error('Save target files before retrying.');
    await investigate(vscode.Uri.file(parent.target), undefined, { categories, label: `Retry: ${parent.cwe}`, parent });
  });
  register('antares.investigate', async (uri?: vscode.Uri) => {
    supported();
    if (!uri) {
      const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select a scan target' });
      if (!folder) return; uri = folder.uri;
    }
    const category = await vscode.window.showQuickPick([
      { label: 'Automatic sweep', description: 'Recommended starting point', detail: 'Let Antares choose relevant weakness categories and investigate them sequentially.', cwe: 'sweep' },
      { label: 'SQL injection', description: 'CWE-89', detail: 'User input changes a database query.', cwe: 'CWE-89' },
      { label: 'Improper authentication', description: 'CWE-287', detail: 'Identity or token validation, including OAuth audience checks.', cwe: 'CWE-287' },
      { label: 'Missing authorization', description: 'CWE-862', detail: 'Operations lack required permission or scope checks.', cwe: 'CWE-862' },
      { label: 'Unintended proxy / confused deputy', description: 'CWE-441', detail: 'Credential forwarding and service-boundary misuse.', cwe: 'CWE-441' },
      { label: 'OS command injection', description: 'CWE-78', detail: 'User input changes a shell or system command.', cwe: 'CWE-78' },
      { label: 'Cross-site scripting', description: 'CWE-79', detail: 'Untrusted content is rendered as executable web content.', cwe: 'CWE-79' },
      { label: 'Path traversal', description: 'CWE-22', detail: 'User-controlled paths escape their intended directory.', cwe: 'CWE-22' },
      { label: 'Custom weakness category…', detail: 'Enter a different CWE identifier.', cwe: '' }
    ], { title: 'What should Antares investigate?', placeHolder: 'Choose a weakness to focus the scan. CWE IDs are standard category labels.', matchOnDescription: true, matchOnDetail: true });
    if (!category) return;
    if (category.cwe === 'sweep') { await startSweep(uri, 'auto'); return; }
    const cwe = category.cwe || await vscode.window.showInputBox({ title: 'Custom weakness category', prompt: 'Enter a Common Weakness Enumeration identifier.', placeHolder: 'CWE-287', validateInput: v => /^CWE-[1-9]\d*$/.test(v) ? null : 'Use a CWE ID such as CWE-287.' });
    if (!cwe) return;
    const dirty = vscode.workspace.textDocuments.some(d => d.isDirty && d.uri.scheme === 'file' && inside(uri!.fsPath, d.uri.fsPath));
    if (dirty) {
      const choice = await vscode.window.showWarningMessage('Antares scans files on disk. Some target files have unsaved changes.', { modal: true }, 'Save All', 'Scan Saved Files');
      if (!choice || (choice === 'Save All' && !await vscode.workspace.saveAll())) return;
    }
    const confirm = await vscode.window.showInformationMessage(`Investigate ${cwe} in ${uri.fsPath} using local ${config().get('model')}? Exclusions come from .antares.toml.`, { modal: true }, 'Investigate');
    if (confirm) await investigate(uri, cwe);
  });
  register('antares.openCandidate', async (root: string, relative: string) => {
    if (!last || last.target !== root || !last.report?.findings.some(f => f.file_path === relative)) throw new Error('Candidate does not belong to the last result.');
    await vscode.window.showTextDocument(vscode.Uri.file(await candidatePath(root, relative)), { viewColumn: vscode.ViewColumn.One, preview: false });
  });
  register('antares.review', showReview);
  register('antares.details', async () => {
    if (!last) throw new Error('No completed or partial result in this session.');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: JSON.stringify(last, null, 2), language: 'json' }));
  });
  async function prepareSnapshot(render = true): Promise<Run> {
    return reviewOperation(() => prepareSnapshotUnlocked(render));
  }
  async function prepareSnapshotUnlocked(render = true): Promise<Run> {
    if (!last) throw new Error('No result to export.');
    await flushDrafts();
    await writes;
    let changed = await refreshDecisions(last);
    const dirtyFiles = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === 'file' && inside(last!.target, d.uri.fsPath)).map(d => path.relative(last!.target, d.uri.fsPath));
    if (dirtyFiles.length && !last.sourceChanged) { last.sourceChanged = true; changed = true; }
    if (changed || unsavedRuns.has(last)) await persist(last);
    refresh();
    if (render && review.visible) review.show(last, review.selected);
    const snapshot = structuredClone(last);
    snapshot.freshness = { checked: new Date().toISOString(), scope: 'Reviewed candidate file hashes only; dependencies are not comprehensively tracked.', dirtyFiles };
    return snapshot;
  }

  register('antares.export', async () => {
    if (busy || savingReview) throw new Error('Wait for the current operation to finish.');
    const snapshot = await prepareSnapshot();
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(snapshot.target, '..', 'antares-result.json')), filters: { JSON: ['json'] } });
    if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(snapshot, null, 2)));
  });
  async function loadRun(id: string) {
    return reviewOperation(async () => { await flushDrafts(); await loadRunUnlocked(id); });
  }
  async function loadRunUnlocked(id: string) {
    const run = (await store.list()).find(r => r.id === id);
    if (!run) throw new Error('Run not found in this workspace.');
    last = run; if (await refreshDecisions(last)) await persist(last); refresh(); syncWatchers(); review.show(last);
  }
  register('antares.retryDraftSave', async () => reviewOperation(async () => {
    if (!last) throw new Error('No review draft to save.');
    await persist(last);
    failedDrafts.delete(last);
    await flushDrafts();
    refresh();
    if (review.visible) review.show(last, review.selected, 'Draft saved.');
    void vscode.window.showInformationMessage('Antares review saved.');
  }));
  register('antares.history', async () => reviewOperation(async () => {
    try { await flushDrafts(); } catch (error) {
      if (!(error instanceof ConflictError) || !last) throw error;
      const recovery = structuredClone(last);
      recovery.parentRunId = last.id; delete recovery.id; recovery.revision = 0; recovery.cwe = `Draft recovery: ${last.cwe}`;
      recovery.started = new Date().toISOString(); await store.save(recovery);
      failedDrafts.delete(last);
      last = recovery; refresh(); review.show(recovery);
      void vscode.window.showInformationMessage('Your local drafts were saved as a recovery run in history. Select a run to continue.');
    }
    const choice = await vscode.window.showQuickPick((await store.list()).map(run => ({ label: `${run.started} · ${run.cwe}`, description: `${run.model} · ${run.status}`, detail: `${run.target} · ${reviewSummary(run)}`, run })), { title: 'Antares Run History' });
    if (choice) { await flushDrafts(); await loadRunUnlocked(choice.run.id!); }
  }));
  function markChanged(file: string) {
    if (scanning && inside(scanning.target, file)) scanning.sourceChanged = true;
    if (savingReview) { deferredChanges.add(file); return; }
    if (!last || !inside(last.target, file) || last.sourceChanged) return;
    last.sourceChanged = true;
    refresh(); review.markStale();
    const run = last;
    void persist(run).catch(error => {
      // Keep the in-memory warning, but make the failure visible; export retries persistence.
      void vscode.window.showErrorMessage(`Antares could not save freshness: ${error.message}`);
    });
  }
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (event.contentChanges.length && event.document.uri.scheme === 'file') markChanged(event.document.uri.fsPath);
  }));
  const watchers = new Map<string, vscode.Disposable[]>();
  function desiredRoots() {
    // A failed/cancelled scan retains the previous result, so both targets
    // must keep receiving filesystem events throughout the investigation.
    const targets = [...new Set([scanning?.target, last?.target].filter((target): target is string =>
      !!target && workspaceRoots.some(root => inside(root, target))))];
    return targets.length ? targets : workspaceRoots;
  }
  function syncWatchers() {
    const wanted = desiredRoots();
    for (const [root, subscriptions] of watchers) if (!wanted.includes(root)) {
      subscriptions.forEach(s => s.dispose()); watchers.delete(root);
    }
    for (const root of wanted) if (!watchers.has(root)) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
      watchers.set(root, [watcher, watcher.onDidChange(uri => markChanged(uri.fsPath)), watcher.onDidCreate(uri => markChanged(uri.fsPath)), watcher.onDidDelete(uri => markChanged(uri.fsPath))]);
    }
  }
  let folderUpdates = Promise.resolve();
  context.subscriptions.push({ dispose: () => { for (const subscriptions of watchers.values()) subscriptions.forEach(s => s.dispose()); watchers.clear(); } });
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    folderUpdates = folderUpdates.then(async () => {
      workspaceRoots = await Promise.all((vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => realpath(f.uri.fsPath)));
      store.setRoots(workspaceRoots); syncWatchers();
    }).catch(error => { void vscode.window.showErrorMessage(`Antares could not update workspace folders: ${error.message}`); });
    return folderUpdates;
  }));
  syncWatchers();
  try {
    try { await store.migrate(); } catch (error) { void vscode.window.showWarningMessage(`Antares legacy result could not be migrated: ${error instanceof Error ? error.message : String(error)}`); }
    last = (await store.list())[0];
    if (last) { if (await refreshDecisions(last)) await persist(last); refresh(); syncWatchers(); }
  } catch (error) {
    candidates.update(`Saved result unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { loadRun, prepareSnapshot, saveDraft, store, investigate, getLastRun: () => last, getCandidates: () => candidates.getChildren(), cancel: () => active?.abort(), showReview, saveDecision, handleReviewMessage, getReviewHtml: () => last ? reviewHtml(last, review.selected, 'testnonce') : '' };

}
