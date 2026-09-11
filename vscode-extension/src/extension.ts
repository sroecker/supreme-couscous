import * as vscode from 'vscode';
import { access, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { candidatePath, childEnvironment, inside, isComplete, parseReport, profile, Report, runCli } from './core';
interface Run { target: string; model: string; cwe: string; status: string; started: string; finished: string; report?: Report }
class Candidates implements vscode.TreeDataProvider<vscode.TreeItem> {
  private event = new vscode.EventEmitter<void>();
  onDidChangeTreeData = this.event.event;
  run?: Run;
  message = 'Run Antares: Investigate CWE to begin.';
  update(message: string, run?: Run) { this.message = message; this.run = run; this.event.fire(); }
  getTreeItem(item: vscode.TreeItem) { return item; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem(this.message), ...(this.run?.report?.findings ?? []).map(f => {
      const item = new vscode.TreeItem(`${f.cwe_ids.join(', ')} · ${f.file_path}`);
      item.description = 'Candidate — review required'; item.tooltip = f.title;
      item.command = { command: 'antares.openCandidate', title: 'Open candidate', arguments: [this.run!.target, f.file_path] };
      return item;
    })];
  }
  dispose() { this.event.dispose(); }
}
let active: AbortController | undefined;
export function deactivate() { active?.abort(); }
export function activate(context: vscode.ExtensionContext) {
  const candidates = new Candidates();
  context.subscriptions.push(candidates, vscode.window.registerTreeDataProvider('antares.candidates', candidates));
  let last: Run | undefined;
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
    if (busy) throw new Error('An investigation is already running.');
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
            await writeFile(path.join(storage, 'last-result.json'), JSON.stringify(run, null, 2), { mode: 0o600 });
            last = run;
            candidates.update(`${run.status} · ${run.report?.findings.length ?? 0} candidates · ${run.model}`, run);
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
    await vscode.window.showTextDocument(vscode.Uri.file(await candidatePath(root, relative)));
  });
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
    if (last && event.document.uri.scheme === 'file' && inside(last.target, event.document.uri.fsPath)) candidates.update('Source changed — results may be stale', last);
  }));
  return { investigate, getLastRun: () => last, getCandidates: () => candidates.getChildren(), cancel: () => active?.abort() };
}
