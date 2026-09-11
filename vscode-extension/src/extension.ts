import * as vscode from 'vscode';
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { counts, decision, invalidateDecision, nextPending, reviewSummary, ReviewStatus, Run, setDecision } from './review-model';
import { ReviewMessage, ReviewPanel, reviewHtml, runKey } from './review-panel';
import { candidatePath, childEnvironment, inside, isComplete, parseReport, profile, Report, runCli } from './core';
class Candidates implements vscode.TreeDataProvider<vscode.TreeItem> {
  private event = new vscode.EventEmitter<void>();
  onDidChangeTreeData = this.event.event;
  run?: Run;
  message = 'Run Antares: Investigate CWE to begin.';
  update(message: string, run?: Run) { this.message = message; this.run = run; this.event.fire(); }
  getTreeItem(item: vscode.TreeItem) { return item; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem(this.message), ...(this.run?.report?.findings ?? []).map((f, index) => {
      const item = new vscode.TreeItem(`${f.cwe_ids.join(', ')} · ${f.file_path}`);
      item.description = decision(this.run!, index).status; item.tooltip = f.title;
      item.iconPath = new vscode.ThemeIcon(({unreviewed: 'circle-outline', confirmed: 'check', dismissed: 'circle-slash'})[decision(this.run!, index).status]);
      item.command = { command: 'antares.review', title: 'Review candidate', arguments: [index] };
      return item;
    })];
  }
  dispose() { this.event.dispose(); }
}
let active: AbortController | undefined;
export function deactivate() { active?.abort(); }
export async function activate(context: vscode.ExtensionContext) {
  const candidates = new Candidates();
  context.subscriptions.push(candidates, vscode.window.registerTreeDataProvider('antares.candidates', candidates));
  let last: Run | undefined;
  let savingReview = false;
  const review = new ReviewPanel(handleReviewMessage);
  context.subscriptions.push(review);
  async function persist(run: Run) {
    const storage = context.globalStorageUri.fsPath;
    await mkdir(storage, { recursive: true, mode: 0o700 });
    const temporary = path.join(storage, 'last-result.json.tmp');
    await writeFile(temporary, JSON.stringify(run, null, 2), { mode: 0o600 });
    await rename(temporary, path.join(storage, 'last-result.json'));
  }
  function refresh() {
    if (last) candidates.update(`${last.status} · ${reviewSummary(last)}`, last);
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
      const run: Run = { ...last, reviews: { ...last.reviews } };
      const finding = run.report?.findings[index];
      if (!finding) throw new Error('Unknown candidate.');
      const file = await candidatePath(run.target, finding.file_path);
      if (vscode.workspace.textDocuments.some(d => d.uri.fsPath === file && d.isDirty)) throw new Error('Save the source file before recording a review decision.');
      const hash = await sourceHash(run, index);
      setDecision(run, index, status, note, hash);
      await persist(run);
      last = run;
      refresh();
      review.show(run, index, status === 'unreviewed' ? 'Notes saved. This candidate remains to review.' : `Decision saved. ${counts(run).unreviewed ? 'Continue with Next unreviewed.' : 'All candidates have a review decision.'}`);
    } finally { savingReview = false; }
  }
  async function handleReviewMessage(message: ReviewMessage) {
    if (!message || typeof message.action !== 'string' || !last || message.run !== runKey(last)) throw new Error('This review belongs to an older run. Open the latest result.');
    if (!Number.isInteger(message.index) || message.index < 0) throw new Error('Invalid candidate.');
    if (['select', 'open', 'decide', 'next'].includes(message.action) && !last.report?.findings[message.index]) throw new Error('Unknown candidate.');
    switch (message.action) {
      case 'select': await showReview(message.index); break;
      case 'open': await vscode.commands.executeCommand('antares.openCandidate', last.target, last.report!.findings[message.index].file_path); break;
      case 'decide': await saveDecision(message.index, message.status as ReviewStatus, message.note as string); break;
      case 'next': await showReview(nextPending(last, message.index)); break;
      case 'export': await vscode.commands.executeCommand('antares.export'); break;
      case 'raw': await vscode.commands.executeCommand('antares.details'); break;
      default: throw new Error('Unknown review action.');
    }
  }
  async function showReview(index = 0) {
    if (!last) throw new Error('Run an investigation first.');
    if (busy || savingReview) throw new Error('Wait for the current operation to finish.');
    if (await refreshDecisions(last)) await persist(last);
    refresh();
    review.show(last, index);
  }
  const config = () => vscode.workspace.getConfiguration('antares');
  const supported = () => {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Antares.');
    if (process.platform !== 'darwin' || vscode.env.remoteName) throw new Error('This MVP supports local macOS workspaces.');
  };
  const register = (name: string, handler: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(name, async (...args: any[]) => {
      try { return await handler(...args); } catch (error) { vscode.window.showErrorMessage(`Antares: ${error instanceof Error ? error.message : String(error)}`); }
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
  register('antares.selectModel', async () => {
    const choice = await vscode.window.showQuickPick(['antares-1b', 'antares-350m'], { title: 'Select a running local model' });
    if (choice) await config().update('model', choice, vscode.ConfigurationTarget.Global);
  });
  let busy = false;
  async function investigate(targetUri: vscode.Uri, cwe: string): Promise<Run> {
    if (busy || savingReview) throw new Error('An investigation or review save is already running.');
    busy = true;
    try { return await performInvestigation(targetUri, cwe); } finally { busy = false; }
  }
  async function performInvestigation(targetUri: vscode.Uri, cwe: string): Promise<Run> {
    supported();
    if (active) throw new Error('An investigation is already running.');
    if (!/^CWE-[1-9]\d*$/.test(cwe)) throw new Error('Enter a CWE ID such as CWE-287.');
    if (targetUri.scheme !== 'file') throw new Error('Select a local folder.');
    const target = await realpath(targetUri.fsPath);
    const roots = await Promise.all((vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => realpath(f.uri.fsPath)));
    if (!roots.some(root => inside(root, target)) || !(await stat(target)).isDirectory()) throw new Error('Choose a directory within the open workspace.');
    const executable = config().get<string>('cliPath', '');
    if (!path.isAbsolute(executable)) throw new Error('Run Antares: Configure Local CLI first.');
    await access(executable, constants.X_OK);
    const connection = profile(config().get<string>('model', 'antares-1b'));
    const budget = config().get<number>('toolBudget', 10), seconds = config().get<number>('timeoutSeconds', 300);
    if (!Number.isInteger(budget) || budget < 1 || budget > 50 || !Number.isInteger(seconds) || seconds < 1 || seconds > 1800) throw new Error('Invalid tool budget or timeout.');
    const storage = context.globalStorageUri.fsPath;
    await mkdir(storage, { recursive: true, mode: 0o700 });
    if (inside(target, await realpath(storage))) throw new Error('Extension storage must be outside the target.');
    const history = path.join(storage, 'cli-history');
    await mkdir(history, { recursive: true, mode: 0o700 });
    const started = new Date().toISOString();
    const abort = new AbortController(); active = abort;
    candidates.update(`Running ${cwe} · ${connection.model}`, last);
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Antares ${connection.model}: ${cwe}`, cancellable: true }, async (progress, token) => {
        const cancel = token.onCancellationRequested(() => abort.abort());
        try {
          progress.report({ message: 'Investigating saved source files…' });
          const result = await runCli(executable, ['tool', 'query', '--stdin'], {
            target, cwe_ids: [cwe], ...connection, backend: 'remote', tool_budget: budget
          }, storage, childEnvironment(history), seconds * 1000, abort.signal);
          const run: Run = { target, model: connection.model, cwe, started, finished: new Date().toISOString(), status: result.stopped ?? 'failed' };
          if (!result.stopped) {
            try {
              run.report = parseReport(result.stdout);
              if (run.report.metadata.model !== connection.model) throw new Error('Result model does not match selected model.');
              run.status = isComplete(run.report, result.exitCode) ? 'completed' : 'incomplete';
            } catch (error) { throw new Error(`CLI exited ${result.exitCode}: ${error instanceof Error ? error.message : String(error)}`); }
          }
          if (result.stopped) candidates.update(`${run.status}; previous result retained`, last);
          else {
            await persist(run);
            last = run;
            refresh();
            review.show(run);
          }
          return run;
        } finally { cancel.dispose(); }
      });
    } catch (error) { candidates.update('Investigation failed; previous result retained', last); throw error; }
    finally { if (active === abort) active = undefined; }
  }
  register('antares.investigate', async (uri?: vscode.Uri) => {
    supported();
    if (!uri) {
      const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select a scan target' });
      if (!folder) return; uri = folder.uri;
    }
    const category = await vscode.window.showQuickPick([
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
  register('antares.export', async () => {
    if (!last) throw new Error('No result to export.');
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(last.target, '..', 'antares-result.json')), filters: { JSON: ['json'] } });
    if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(last, null, 2)));
  });
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (event.contentChanges.length && last && event.document.uri.scheme === 'file' && inside(last.target, event.document.uri.fsPath)) {
      last.sourceChanged = true;
      candidates.update('Source changed — results may be stale', last);
    }
  }));
  try {
    const saved = JSON.parse(await readFile(path.join(context.globalStorageUri.fsPath, 'last-result.json'), 'utf8'));
    if (!['target', 'model', 'cwe', 'started', 'finished'].every(k => typeof saved[k] === 'string') ||
        !['completed', 'incomplete'].includes(saved.status)) throw new Error('Invalid saved result.');
    saved.report = parseReport(JSON.stringify(saved.report));
    const roots = await Promise.all((vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => realpath(f.uri.fsPath)));
    if (roots.some(root => inside(root, saved.target))) {
      const rawReviews = saved.reviews;
      saved.reviews = {};
      for (const [key, value] of Object.entries(rawReviews ?? {})) {
        const d = value as any;
        if (/^(0|[1-9]\d*)$/.test(key) && saved.report.findings[Number(key)] &&
            ['unreviewed', 'confirmed', 'dismissed'].includes(d?.status) && typeof d.note === 'string' && d.note.length <= 4000 && typeof d.updated === 'string' &&
            (d.sourceHash === undefined || /^[a-f0-9]{64}$/.test(d.sourceHash))) saved.reviews[key] = d;
      }
      last = saved;
      if (await refreshDecisions(last!)) await persist(last!);
      refresh();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') candidates.update('Saved result unavailable. Run a new investigation.');
  }
  return { investigate, getLastRun: () => last, getCandidates: () => candidates.getChildren(), cancel: () => active?.abort(), showReview, saveDecision, handleReviewMessage, getReviewHtml: () => last ? reviewHtml(last, review.selected, 'testnonce') : '' };

}
