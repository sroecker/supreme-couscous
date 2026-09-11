import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { counts, decision, escapeHtml as e, guidance, Run } from './review-model';
export interface ReviewMessage { run: string; action: string; index: number; status?: string; note?: string }
export function runKey(run: Run) { return `${run.started}:${run.target}`; }
export function reviewHtml(run: Run, index: number, nonce: string, message = '') {
  const findings = run.report?.findings ?? [], f = findings[index], d = decision(run, index), c = counts(run);
  const steps = guidance[run.cwe] ?? ['Trace untrusted input and the relevant sensitive operation.', 'Check controls in this file and its callers or middleware.', 'Record concrete evidence before confirming or dismissing the candidate.'];
  const warning = run.status !== 'completed' ? 'Investigation incomplete. Candidates may be partial; an empty list does not mean the code is safe.' : 'Investigation completed. These are model-selected files, not verified vulnerabilities.';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:1000px;margin:auto;line-height:1.5}h1{font-size:24px;margin:4px 0}h2{font-size:18px}small,.muted{color:var(--vscode-descriptionForeground)}.summary{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.stat{padding:12px 18px;border:1px solid var(--vscode-panel-border);border-radius:6px}.stat strong{display:block;font-size:23px}.notice{padding:12px;border-left:3px solid var(--vscode-focusBorder);background:var(--vscode-textBlockQuote-background);margin:16px 0}.layout{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,2fr);gap:24px}button{cursor:pointer;font:inherit;border:1px solid transparent;padding:8px 12px;border-radius:3px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:hover{background:var(--vscode-button-hoverBackground)}button:focus,textarea:focus{outline:2px solid var(--vscode-focusBorder)}button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button.candidate{display:block;text-align:left;width:100%;margin-bottom:8px;background:transparent;color:inherit;border:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}button.selected{border-color:var(--vscode-focusBorder)}textarea{box-sizing:border-box;width:100%;min-height:90px;padding:10px;font:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.path{overflow-wrap:anywhere}#feedback{color:var(--vscode-descriptionForeground);min-height:24px}@media(max-width:650px){.layout{grid-template-columns:1fr}}
</style></head><body data-run="${e(runKey(run))}">
<small>ANTARES • LOCAL CODE REVIEW</small><h1>Review candidates</h1><p class="muted path">${e(run.cwe)} · ${e(run.model)} · ${e(run.target)}</p>
<div class="summary"><div class="stat"><strong>${c.unreviewed}</strong>To review</div><div class="stat"><strong>${c.confirmed}</strong>Confirmed by you</div><div class="stat"><strong>${c.dismissed}</strong>Dismissed by you</div></div>
<div class="notice">${e(warning)}${run.sourceChanged ? '<br><strong>Source changed since this result. Re-scan to refresh the investigation; affected decisions need review again.</strong>' : ''}</div>
${run.report?.warnings?.length ? `<details><summary>Investigation warnings</summary><ul>${run.report.warnings.map(w => `<li>${e(w)}</li>`).join('')}</ul></details>` : ''}
${findings.length ? `<div class="layout"><nav aria-label="Candidates"><h2>Files (${findings.length})</h2>${findings.map((item, i) => `<button class="candidate ${i === index ? 'selected' : ''}" data-action="select" data-index="${i}" ${i === index ? 'aria-current="true"' : ''}>${e(item.file_path)}<br><small>${e(decision(run, i).status)}</small></button>`).join('')}</nav><main><small>Candidate ${index + 1} of ${findings.length} · ${e(d.status)}</small><h2 class="path">${e(f?.file_path)}</h2><p>${e(f?.title)}</p>
<p class="muted">Antares supplied a file-level candidate, without a verified line location or explanation. The checklist below is general review guidance.</p>
<button data-action="open" data-index="${index}">Open source beside review</button>
<h2>What to check</h2><ol>${steps.map(s => `<li>${e(s)}</li>`).join('')}</ol>
<label for="note"><strong>Review notes</strong> <span class="muted">— required when dismissing</span></label><textarea id="note" maxlength="4000" placeholder="Record the relevant code, protection, or reason for your decision.">${e(d.note)}</textarea>
<div class="actions"><button data-action="decide" data-status="confirmed" data-index="${index}">Confirm issue</button><button class="secondary" data-action="decide" data-status="dismissed" data-index="${index}">Dismiss candidate</button><button class="secondary" data-action="decide" data-status="unreviewed" data-index="${index}">Save as unreviewed</button></div>
<p class="muted">Confirm records your assessment; it does not modify the code. Dismiss applies only to this run. New scans start unreviewed.</p>
<button class="secondary" data-action="next" data-index="${index}">Next unreviewed</button>
</main></div>` : `<h2>No candidates returned</h2><p>${run.status === 'completed' ? 'No files were selected for this weakness. This is not a security clearance.' : 'Complete another investigation before drawing conclusions.'}</p>`}
<p id="feedback" role="status">${e(message)}</p><div class="actions"><button class="secondary" data-action="export" data-index="${index}">Export result and review</button><button class="secondary" data-action="raw" data-index="${index}">Raw result</button></div>
<script nonce="${nonce}">const api=acquireVsCodeApi();let dirty=false;document.getElementById('note')?.addEventListener('input',()=>dirty=true);document.querySelectorAll('button[data-action]').forEach(b=>b.addEventListener('click',()=>{if(dirty&&['select','next'].includes(b.dataset.action)){document.getElementById('feedback').textContent='Save your review notes with a decision or “Save as unreviewed” before changing candidates.';return;}api.postMessage({run:document.body.dataset.run,action:b.dataset.action,index:Number(b.dataset.index),status:b.dataset.status,note:document.getElementById('note')?.value??''});}));</script></body></html>`;
}
export class ReviewPanel {
  private panel?: vscode.WebviewPanel;
  selected = 0;
  constructor(private handler: (message: ReviewMessage) => Promise<void>) {}
  show(run: Run, index = 0, message = '') {
    this.selected = Math.max(0, Math.min(index, (run.report?.findings.length ?? 1) - 1));
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('antares.review', 'Antares Review', vscode.ViewColumn.Two, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
      this.panel.onDidDispose(() => this.panel = undefined);
      this.panel.webview.onDidReceiveMessage(async m => {
        try { await this.handler(m); } catch (error) { vscode.window.showErrorMessage(`Antares: ${error instanceof Error ? error.message : String(error)}`); }
      });
    }
    this.panel.reveal(vscode.ViewColumn.Two, true);
    this.panel.webview.html = reviewHtml(run, this.selected, randomBytes(16).toString('hex'), message);
  }
  get visible() { return !!this.panel; }
  dispose() { this.panel?.dispose(); }
}
