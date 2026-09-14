const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),Module=require('node:module');
const {scanProfiles,explicitSweepRequest,failedCategories,categoryCoverage}=require('../dist/core');
test('named profiles and retry requests preserve exact bounded categories',()=>{
 const request=explicitSweepRequest('/repo',{model:'antares-350m',endpoint:'http://127.0.0.1:8086/v1/completions'},10,scanProfiles.web.categories);
 assert.equal(request.mode,'sweep');assert.equal(request.payload.workers,1);assert.deepEqual(request.payload.cwe_ids,['CWE-89','CWE-79','CWE-78','CWE-22']);
 assert.deepEqual(categoryCoverage({per_cwe_results:[]},['CWE-89'])[0],{id:'CWE-89',label:'SQL injection (CWE-89)',status:'not run'});
 assert.deepEqual(failedCategories({per_cwe_results:[]},['CWE-89']),['CWE-89']);
 assert.deepEqual(scanProfiles.oauth.categories,['CWE-287','CWE-862','CWE-441']);assert.throws(()=>explicitSweepRequest('/a',{model:'m',endpoint:'e'},10,[]));
 assert.deepEqual(failedCategories({per_cwe_results:[{cwe_id:'CWE-89',error_message:null},{cwe_id:'CWE-79',error_message:'failed'}]}),['CWE-79']);
});

async function harness(t, legacy=true) {
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'antares-workflow-')));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const root=path.join(temp,'repo'),storage=path.join(temp,'storage');await fs.mkdir(root);await fs.mkdir(storage);await fs.writeFile(path.join(root,'app.py'),'before');
 const run={target:root,model:'antares-350m',cwe:'CWE-89',status:'completed',started:'2026-09-12T00:00:00Z',finished:'2026-09-12T00:01:00Z',report:{metadata:{model:'antares-350m'},summary:{generation_errors:0,failed_workers:0},findings:[{file_path:'app.py',cwe_ids:['CWE-89'],title:'candidate'}]}};
 if(legacy)await fs.writeFile(path.join(storage,'last-result.json'),JSON.stringify(run));
 const commands=new Map(),disposable={dispose(){}},panels=[],warnings=[],errors=[];let current,change;const settings={cliPath:process.execPath};
 const vscode={
  EventEmitter:class{event=()=>disposable;fire(){}dispose(){}},TreeItem:class{constructor(label){this.label=label}},ThemeIcon:class{},RelativePattern:class{},
  Uri:{file:fsPath=>({fsPath,scheme:'file'})},ViewColumn:{One:1,Two:2},ConfigurationTarget:{Global:1},ProgressLocation:{Notification:1},
  env:{remoteName:undefined},workspace:{isTrusted:true,workspaceFolders:[{uri:{fsPath:root,scheme:'file'}}],textDocuments:[],getConfiguration:()=>({get:(k,d)=>settings[k]??d}),onDidChangeTextDocument:fn=>{change=fn;return disposable},createFileSystemWatcher:()=>({dispose(){},onDidChange:()=>disposable,onDidCreate:()=>disposable,onDidDelete:()=>disposable})},
  commands:{registerCommand:(name,handler)=>{commands.set(name,handler);return disposable},executeCommand:async(name,...args)=>commands.get(name)(...args)},
  window:{withProgress:async(_options,fn)=>fn({report(){}},{onCancellationRequested:()=>disposable}),registerTreeDataProvider:()=>disposable,createOutputChannel:()=>({dispose(){}}),showErrorMessage:message=>errors.push(message),showWarningMessage:message=>warnings.push(message),showInformationMessage:()=>{},
   createWebviewPanel:()=>{
    let receive,state,html;const pending=[];const panel={dispose(){},reveal(){},onDidDispose:()=>{},webview:{onDidReceiveMessage:fn=>receive=fn,postMessage:async data=>{if(current)current.message({data});return true}}};
    Object.defineProperty(panel.webview,'html',{get:()=>html,set:value=>{
     html=value;const note={value:'',disabled:false,addEventListener:(name,fn)=>note[name]=fn};const match=value.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/);note.value=match?.[1]??'';const feedback={},stale={};const document={body:{dataset:{run:value.match(/data-run="([^"]+)"/)[1]}},getElementById:id=>({note,feedback,stale})[id],querySelectorAll:()=>[]};
     const window={addEventListener:(_n,fn)=>window.message=fn};
     vm.runInNewContext(value.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1],{document,window,acquireVsCodeApi:()=>({getState:()=>state,setState:s=>state=s,postMessage:m=>{pending.push(Promise.resolve().then(()=>receive(m)))}}),setTimeout,clearTimeout});
     current={note,message:window.message,pending};
    }});panels.push(panel);return panel;
   }
  }
 };
 const original=Module._load;Module._load=function(name,...rest){return name==='vscode'?vscode:original.call(this,name,...rest)};
 let extension;try{delete require.cache[require.resolve('../dist/extension')];delete require.cache[require.resolve('../dist/review-panel')];extension=require('../dist/extension');}finally{Module._load=original;}
 const subscriptions=[];const api=await extension.activate({globalStorageUri:{fsPath:storage},subscriptions});t.after(()=>subscriptions.forEach(s=>s.dispose()));
 return {api,root,run,panels,warnings,errors,vscode,get current(){return current},edit:()=>change({contentChanges:[{}],document:{uri:{fsPath:path.join(root,'app.py'),scheme:'file'}}})};
}

test('webview drafts survive Explorer navigation and export rechecks external source edits',async t=>{
 const h=await harness(t),{api,root}=h;
 await api.showReview();h.current.note.value='Draft entered through real panel script';h.current.note.input();
 await api.showReview();assert.equal(h.current.note.value,'Draft entered through real panel script');assert.equal((await api.store.list())[0].drafts[0].note,'Draft entered through real panel script');
 h.current.note.value='Earlier draft';h.current.note.input();h.current.message({data:{action:'flush',id:'test-flush'}});
 h.current.note.value='Newer keystrokes';h.current.note.input();h.current.message({data:{action:'saved',sequence:2}});
 await api.showReview();assert.equal(h.current.note.value,'Newer keystrokes');
 await api.saveDecision(0,'confirmed','Evidence');await fs.writeFile(path.join(root,'app.py'),'after');
 const snapshot=await api.prepareSnapshot();assert.equal(snapshot.reviews[0].status,'unreviewed');assert.equal(snapshot.reviews[0].note,'Evidence');assert.equal(snapshot.sourceChanged,true);assert.match(snapshot.freshness.scope,/candidate/);
});

function mockScan(t, callback) {
 const core=require('../dist/core');
 t.mock.method(core,'checkServer',async()=>{});
 t.mock.method(core,'runCli',callback);
}
function result(run){return {stdout:JSON.stringify({...run.report,metadata:{model:'antares-1b'}}),stderr:'',exitCode:0};}

test('scan lock is acquired before awaiting a draft flush and released after failure',async t=>{
 const h=await harness(t);let starts=0;
 mockScan(t,async()=>{starts++;return result(h.run)});
 const outcomes=await Promise.allSettled([h.api.investigate(h.vscode.Uri.file(h.root),'CWE-89'),h.api.investigate(h.vscode.Uri.file(h.root),'CWE-89')]);
 assert.equal(starts,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 await assert.rejects(h.api.investigate(h.vscode.Uri.file('/missing-target'),'CWE-89'));
 await h.api.investigate(h.vscode.Uri.file(h.root),'CWE-89');assert.equal(starts,2);
});

test('completed scan is durable even when the previous draft cannot flush',async t=>{
 const h=await harness(t);await h.api.showReview();const oldId=h.api.getLastRun().id;
 const save=h.api.store.save.bind(h.api.store);let failOld=false;
 t.mock.method(h.api.store,'save',async run=>{
  if(failOld&&run.id===oldId)throw new (require('../dist/store').ConflictError)();
  return save(run);
 });
 mockScan(t,async()=>{failOld=true;h.current.note.value='Preserve this conflicting draft';h.current.note.input();return result(h.run)});
 const next=await h.api.investigate(h.vscode.Uri.file(h.root),'CWE-89');
 assert.equal(next.status,'completed');assert.ok((await h.api.store.list()).some(r=>r.id===next.id));
 assert.equal(h.api.getLastRun().id,oldId);assert.match(h.current.note.value,/conflicting draft/);assert.match(h.warnings.join(' '),/saved the new scan to Run History/);
});

test('first scan tracks edits during inference and stale events cause only one save',async t=>{
 const h=await harness(t,false);mockScan(t,async()=>{h.edit();return result(h.run)});
 const run=await h.api.investigate(h.vscode.Uri.file(h.root),'CWE-89');assert.equal(run.sourceChanged,true);assert.equal((await h.api.store.list())[0].sourceChanged,true);
 // Load a fresh result, then simulate typing and a build's burst of file events.
 run.sourceChanged=false;await h.api.store.save(run);await h.api.loadRun(run.id);
 const save=h.api.store.save.bind(h.api.store);let writes=0;t.mock.method(h.api.store,'save',async run=>{writes++;return save(run)});
 for(let i=0;i<100;i++)h.edit();
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(writes,1);assert.equal((await h.api.store.list())[0].sourceChanged,true);
});
