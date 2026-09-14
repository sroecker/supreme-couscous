const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {parseReport,isComplete,candidatePath,runCli,profile,childEnvironment}=require('../dist/core');
const good={findings:[],summary:{generation_errors:0,failed_workers:0},metadata:{model:'antares-350m'}};
test('completion requires valid schema and successful exit',()=>{
 assert.equal(isComplete(parseReport(JSON.stringify(good)),0),true);
 assert.equal(isComplete(good,2),false);
 assert.equal(isComplete({...good,warnings:['incomplete']},0),false);
 assert.equal(isComplete({...good,summary:{...good.summary,incomplete_reason:'missing submission'}},0),false);
 assert.throws(()=>parseReport('{}')); assert.throws(()=>parseReport('log\n{}'));
});
test('fixed profiles and restricted child environment',()=>{
 assert.match(profile('antares-350m').endpoint,/:8086/);assert.match(profile('antares-1b').endpoint,/:8082/);
 assert.throws(()=>profile('custom'));process.env.ANTARES_API_KEY='test-secret';
 assert.equal(childEnvironment('/tmp/history').ANTARES_API_KEY,undefined);delete process.env.ANTARES_API_KEY;
});
test('finding navigation rejects traversal and escaping symlinks',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'antares-path-'));
 await fs.writeFile(path.join(root,'ok.py'),'x');await fs.symlink('/etc/hosts',path.join(root,'escape'));
 assert.equal(await candidatePath(root,'ok.py'),await fs.realpath(path.join(root,'ok.py')));
 await assert.rejects(candidatePath(root,'../hosts'));await assert.rejects(candidatePath(root,'/etc/hosts'));
 await assert.rejects(candidatePath(root,'escape'));await fs.rm(root,{recursive:true});
});
test('process accepts JSON stdin without shell expansion',async()=>{
 const result=await runCli(process.execPath,['-e','process.stdin.on("data",b=>process.stdout.write(b))'],{value:'$(touch never)'},os.tmpdir(),{},2000,new AbortController().signal);
 assert.equal(result.exitCode,0);assert.equal(JSON.parse(result.stdout).value,'$(touch never)');
});
test('timeout and cancellation terminate a hanging process',async()=>{
 const r=await runCli(process.execPath,['-e','setInterval(()=>{},1000)'],{},os.tmpdir(),{},50,new AbortController().signal);
 assert.equal(r.stopped,'timeout');
 const abort=new AbortController();const pending=runCli(process.execPath,['-e','setInterval(()=>{},1000)'],{},os.tmpdir(),{},2000,abort.signal);
 setTimeout(()=>abort.abort(),50);assert.equal((await pending).stopped,'cancelled');
});
test('recorded false positives remain findings, incomplete stays incomplete',async()=>{
 const root=path.resolve(__dirname,'../../reports');
 const report=parseReport(await fs.readFile(path.join(root,'antares-350m-demo.json'),'utf8'));
 assert.equal(report.findings[0].file_path,'app.py');assert.equal(isComplete(report,0),true);
 const rows=JSON.parse(await fs.readFile(path.join(root,'fastmcp-oauth-summary.json'),'utf8'));
 assert.equal(rows.find(r=>r.case==='audience'&&r.variant==='fixed').complete,false);
});
test('preserves UTF-8 characters split across stdout chunks',async()=>{
 const r=await runCli(process.execPath,['-e','process.stdout.write(Buffer.from([0xe2]));setTimeout(()=>process.stdout.write(Buffer.from([0x82,0xac])),20)'],{},os.tmpdir(),{},2000,new AbortController().signal);
 assert.equal(r.stdout,'€');
});
test('CLI failure preserves stderr instead of reporting an empty JSON parse error',async()=>{
 const {cliReport}=require('../dist/core');
 const r=await runCli(process.execPath,['-e','console.error("Error: Could not reach the inference endpoint (ConnectError).");process.exit(2)'],{},os.tmpdir(),{},2000,new AbortController().signal);
 assert.equal(r.stdout,'');assert.equal(r.exitCode,2);
 assert.throws(()=>cliReport(r),/Could not reach the inference endpoint/);
 assert.throws(()=>cliReport({...r,stderr:''}),/No report or error details/);
 assert.throws(()=>cliReport({...r,stdout:'{"summary":',stderr:''}),/invalid or truncated/);
});
test('valid partial JSON survives exit 2 and diagnostics redact common credentials',()=>{
 const {cliReport}=require('../dist/core');
 assert.equal(isComplete(cliReport({stdout:JSON.stringify(good),stderr:'warning',exitCode:2}),2),false);
 try {cliReport({stdout:'',stderr:'Error Bearer abc api_key=secret123',exitCode:2});assert.fail();}
 catch(e){assert.match(e.message,/redacted/);assert.doesNotMatch(e.message,/abc|secret123/);}
});
test('connection check explains stopped and loading servers',async()=>{
 const {checkServer,LocalServerError}=require('../dist/core');const previous=global.fetch;
 try {
  global.fetch=async()=>{throw Error('offline')};
  await assert.rejects(checkServer(profile('antares-350m')),e=>e instanceof LocalServerError && e.message.includes('8086') && e.startCommand.includes('ANTARES_MODEL=antares-350m'));
  global.fetch=async()=>({ok:false,status:503});await assert.rejects(checkServer(profile('antares-1b')),/not ready/);
  global.fetch=async()=>({ok:true,status:200});await checkServer(profile('antares-1b'));
 }finally{global.fetch=previous;}
});
test('automatic sweep selects categories and fixes concurrency at one worker',()=>{
 const {scanRequest}=require('../dist/core');
 const sweep=scanRequest('/target',profile('antares-350m'),10);
 assert.equal(sweep.mode,'sweep');assert.equal(sweep.payload.workers,1);
 assert.deepEqual(sweep.payload.selection,{scope:'auto',max_cwes:3});assert.equal(sweep.payload.cwe_ids,undefined);
 assert.deepEqual(scanRequest('/target',profile('antares-1b'),10,'CWE-89').payload.cwe_ids,['CWE-89']);
 assert.throws(()=>scanRequest('/target',profile('antares-1b'),10,undefined,11));
 assert.throws(()=>scanRequest('/target',profile('antares-1b'),10,''));
});
test('per-category errors remain incomplete and malformed sweep reports are rejected',()=>{
 const r={...good,per_cwe_results:[{cwe_id:'CWE-89',finding_count:0,error_message:'worker failed'}]};
 assert.equal(isComplete(parseReport(JSON.stringify(r)),0),false);
 assert.throws(()=>parseReport(JSON.stringify({...good,per_cwe_results:'bad'})));
});

test('server hints pin the requested model and port despite inherited overrides',async()=>{
 const {checkServer}=require('../dist/core');const previous=global.fetch;global.fetch=async()=>{throw Error('offline')};
 try{
  for(const model of ['antares-1b','antares-350m']){
   const connection=profile(model);await assert.rejects(checkServer(connection),e=>e.startCommand===`ANTARES_MODEL=${model} ANTARES_PORT=${new URL(connection.endpoint).port} ./scripts/serve.sh`);
  }
  await assert.rejects(checkServer({model:'antares-1b',endpoint:'http://127.0.0.1:8099/v1/completions'}),e=>e.startCommand.includes('ANTARES_PORT=8099'));
 }finally{global.fetch=previous}
});
