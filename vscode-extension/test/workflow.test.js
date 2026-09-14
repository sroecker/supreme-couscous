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

test('webview drafts survive Explorer navigation and export rechecks external source edits',async t=>{
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'antares-workflow-')));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const root=path.join(temp,'repo'),storage=path.join(temp,'storage');await fs.mkdir(root);await fs.mkdir(storage);await fs.writeFile(path.join(root,'app.py'),'before');
 const run={target:root,model:'antares-350m',cwe:'CWE-89',status:'completed',started:'2026-09-12T00:00:00Z',finished:'2026-09-12T00:01:00Z',report:{metadata:{model:'antares-350m'},summary:{generation_errors:0,failed_workers:0},findings:[{file_path:'app.py',cwe_ids:['CWE-89'],title:'candidate'}]}};
 await fs.writeFile(path.join(storage,'last-result.json'),JSON.stringify(run));
 const commands=new Map(),disposable={dispose(){}},panels=[];let current;
 const vscode={
  EventEmitter:class{event=()=>disposable;fire(){}dispose(){}},TreeItem:class{constructor(label){this.label=label}},ThemeIcon:class{},RelativePattern:class{},
  Uri:{file:fsPath=>({fsPath,scheme:'file'})},ViewColumn:{One:1,Two:2},ConfigurationTarget:{Global:1},ProgressLocation:{Notification:1},
  env:{remoteName:undefined},workspace:{isTrusted:true,workspaceFolders:[{uri:{fsPath:root,scheme:'file'}}],textDocuments:[],getConfiguration:()=>({get:(_k,d)=>d}),onDidChangeTextDocument:()=>disposable,createFileSystemWatcher:()=>({dispose(){},onDidChange:()=>disposable,onDidCreate:()=>disposable,onDidDelete:()=>disposable})},
  commands:{registerCommand:(name,handler)=>{commands.set(name,handler);return disposable},executeCommand:async(name,...args)=>commands.get(name)(...args)},
  window:{registerTreeDataProvider:()=>disposable,createOutputChannel:()=>({dispose(){}}),showErrorMessage:message=>{throw new Error(message)},showInformationMessage:()=>{},
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
 let extension;try{delete require.cache[require.resolve('../dist/extension')];extension=require('../dist/extension');}finally{Module._load=original;}
 const subscriptions=[];const api=await extension.activate({globalStorageUri:{fsPath:storage},subscriptions});t.after(()=>subscriptions.forEach(s=>s.dispose()));
 await api.showReview();current.note.value='Draft entered through real panel script';current.note.input();
 await api.showReview();assert.equal(current.note.value,'Draft entered through real panel script');assert.equal((await api.store.list())[0].drafts[0].note,'Draft entered through real panel script');
 current.note.value='Earlier draft';current.note.input();current.message({data:{action:'flush',id:'test-flush'}});
 current.note.value='Newer keystrokes';current.note.input();current.message({data:{action:'saved',sequence:2}});
 await api.showReview();assert.equal(current.note.value,'Newer keystrokes');
 await api.saveDecision(0,'confirmed','Evidence');await fs.writeFile(path.join(root,'app.py'),'after');
 const snapshot=await api.prepareSnapshot();assert.equal(snapshot.reviews[0].status,'unreviewed');assert.equal(snapshot.reviews[0].note,'Evidence');assert.equal(snapshot.sourceChanged,true);assert.match(snapshot.freshness.scope,/candidate/);
});
