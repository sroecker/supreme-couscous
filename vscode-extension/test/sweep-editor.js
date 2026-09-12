const vscode=require('vscode');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
exports.run=async()=>{
 const root=process.env.ANTARES_TEST_ROOT;assert.ok(root);
 const extension=vscode.extensions.getExtension('sroecker.antares-local');const api=await extension.activate();
 assert.ok((await vscode.commands.getCommands()).includes('antares.sweep'));
 const config=vscode.workspace.getConfiguration('antares');
 await config.update('cliPath',path.join(root,'.venv/bin/antares'),vscode.ConfigurationTarget.Global);
 await config.update('model','antares-350m',vscode.ConfigurationTarget.Global);
 await config.update('sweepMaxCwes',3,vscode.ConfigurationTarget.Global);
 const run=await api.investigate(vscode.Uri.file(path.join(root,'examples/demo')));
 assert.equal(run.mode,'sweep');assert.equal(run.report.metadata.mode,'cwe_sweep');
 assert.equal(run.report.metadata.model,'antares-350m');assert.ok(['completed','incomplete'].includes(run.status));
 assert.ok(run.report.per_cwe_results.length>0&&run.report.per_cwe_results.length<=3);
 assert.match(api.getReviewHtml(),/Categories investigated/);
 assert.equal(api.getCandidates().length,run.report.findings.length+1);
 await fs.writeFile(path.join(root,'logs/vscodium-sweep-test.json'),JSON.stringify({editor:vscode.env.appName,version:vscode.version,run},null,2));
 console.log('Automatic sweep integration passed',run.status,run.report.per_cwe_results.map(r=>r.cwe_id));
};
