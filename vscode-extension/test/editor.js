const vscode=require('vscode');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
exports.run=async()=>{
 const root=process.env.ANTARES_TEST_ROOT;
 if(!root)throw Error('Set ANTARES_TEST_ROOT');
 const extension=vscode.extensions.getExtension('sroecker.antares-local');assert.ok(extension);
 const api=await extension.activate();
 const commands=await vscode.commands.getCommands();assert.ok(commands.includes('antares.investigate'));
 const config=vscode.workspace.getConfiguration('antares');
 await config.update('cliPath',path.join(root,'.venv/bin/antares'),vscode.ConfigurationTarget.Global);
 const results=[];
 for(const model of ['antares-350m','antares-1b']){
  await config.update('model',model,vscode.ConfigurationTarget.Global);
  const run=await api.investigate(vscode.Uri.file(path.join(root,'examples/demo')),'CWE-89');
  assert.equal(run.model,model);assert.equal(run.report.metadata.model,model);
  assert.ok(['completed','incomplete'].includes(run.status));
  assert.equal(api.getCandidates().length,run.report.findings.length+1);
  if(run.report.findings.some(f=>f.file_path==='app.py')){
   await vscode.commands.executeCommand('antares.openCandidate',run.target,'app.py');
   assert.equal(vscode.window.activeTextEditor.document.uri.fsPath,path.join(root,'examples/demo/app.py'));
  }
  results.push(run);
 }
 await vscode.commands.executeCommand('antares.details');
 assert.equal(vscode.window.activeTextEditor.document.languageId,'json');
 await fs.writeFile(path.join(root,'logs/vscodium-extension-test.json'),JSON.stringify({editor:vscode.env.appName,version:vscode.version,results},null,2));
 console.log('Antares extension integration passed:',vscode.env.appName,vscode.version);
};
