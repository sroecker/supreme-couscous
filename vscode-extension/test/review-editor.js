const vscode=require('vscode');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
exports.run=async()=>{
 const root=process.env.ANTARES_TEST_ROOT;assert.ok(root);
 const ext=vscode.extensions.getExtension('sroecker.antares-local');const api=await ext.activate();
 const run=api.getLastRun();assert.ok(run,'Existing scan must restore');assert.equal(run.report.findings[0].file_path,'app.py');
 await vscode.commands.executeCommand('antares.review');
 assert.match(api.getReviewHtml(),/Review candidates/);assert.match(api.getReviewHtml(),/Open source beside review/);
 if(process.env.ANTARES_REVIEW_RESTORE==='1'){
  assert.equal(run.reviews['0'].status,'dismissed');assert.equal(run.reviews['0'].note,'Test review note; not a security verdict.');
 }else{
  await api.saveDecision(0,'confirmed','Test review only, validated UI state.');assert.equal(api.getLastRun().reviews['0'].status,'confirmed');
  assert.equal(api.getCandidates()[1].description,'confirmed');
  await assert.rejects(api.saveDecision(0,'dismissed',''));
  await api.handleReviewMessage({run:`${run.started}:${run.target}`,action:'open',index:0});
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath,path.join(root,'examples/demo/app.py'));
  await assert.rejects(api.handleReviewMessage({run:'old-run',action:'decide',index:0,status:'confirmed',note:'x'}));
  await api.saveDecision(0,'dismissed','Test review note; not a security verdict.');
  assert.equal(api.getLastRun().reviews['0'].status,'dismissed');
 }
 await fs.writeFile(path.join(root,'logs/vscodium-review-test'+(process.env.ANTARES_REVIEW_RESTORE?'restore':'')+'.json'),JSON.stringify({editor:vscode.env.appName,version:vscode.version,restored:!!process.env.ANTARES_REVIEW_RESTORE,review:api.getLastRun().reviews},null,2));
 console.log('Review workflow passed',process.env.ANTARES_REVIEW_RESTORE?'persistence reload':'actions');
};
