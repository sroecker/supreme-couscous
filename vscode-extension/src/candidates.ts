import * as vscode from 'vscode';
import { decision, Run } from './review-model';

export class Candidates implements vscode.TreeDataProvider<vscode.TreeItem> {
  private event = new vscode.EventEmitter<void>();
  onDidChangeTreeData = this.event.event;
  run?: Run;
  message = 'Run Antares: Sweep Code or Setup and Server Status to begin.';
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
