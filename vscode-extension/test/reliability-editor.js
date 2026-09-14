const vscode=require('vscode'), assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
exports.run=async()=>{
 const root=process.env.ANTARES_TEST_ROOT;const extension=vscode.extensions.getExtension('sroecker.antares-local');const api=await extension.activate();
 const target=path.join(root,'logs/editor-fixture');await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'app.py'),'before');
 const run={target,model:'antares-350m',cwe:'CWE-89',status:'completed',started:new Date().toISOString(),finished:new Date().toISOString(),report:{metadata:{model:'antares-350m'},summary:{generation_errors:0,failed_workers:0},findings:[{file_path:'app.py',cwe_ids:['CWE-89'],title:'Synthetic editor test candidate'}]}};
 await api.store.save(run);await api.loadRun(run.id);await api.prepareSnapshot();
 await api.saveDraft(0,'Persisted editor draft');await api.showReview();assert.match(api.getReviewHtml(),/Persisted editor draft/);
 await api.saveDecision(0,'confirmed','Synthetic test evidence');await fs.writeFile(path.join(target,'app.py'),'after');
 const snapshot=await api.prepareSnapshot();assert.equal(snapshot.reviews[0].status,'unreviewed');assert.equal(snapshot.sourceChanged,true);assert.equal(snapshot.reviews[0].note,'Synthetic test evidence');
 const history=await api.store.list();assert.ok(history.find(r=>r.id===run.id));
 await fs.writeFile(path.join(root,'logs/reliability-editor-test.json'),JSON.stringify({editor:vscode.env.appName,version:vscode.version,extension:extension.packageJSON.version,snapshot},null,2));
 console.log('Reliability editor test passed');
 if(process.env.ANTARES_KEEP_EDITOR_OPEN==='1')await new Promise(resolve=>setTimeout(resolve,600000));
};
