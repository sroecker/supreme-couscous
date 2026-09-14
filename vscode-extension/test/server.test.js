const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {serverStatus,validatePocRoot,LocalServers}=require('../dist/server');
test('status distinguishes unavailable server and advertised alias without claiming verified weights',async t=>{
 const original=global.fetch;t.after(()=>global.fetch=original);
 global.fetch=async()=>{throw new Error('offline')};assert.equal((await serverStatus('antares-350m')).ready,false);
 global.fetch=async url=>String(url).endsWith('/health')?{ok:true}:{json:async()=>({data:[{id:'antares-350m'}]})};
 const status=await serverStatus('antares-350m');assert.equal(status.ready,true);assert.match(status.description,/not independently verified/);
});
test('explicit startup validates root and does not adopt an already running server',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'antares-server-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const directory of ['scripts','models','.venv/bin','build/llama.cpp/bin'])await fs.mkdir(path.join(root,directory),{recursive:true});
 for(const file of ['scripts/serve.sh','scripts/model_profile.sh','models/antares-350m-bf16.gguf','.venv/bin/python','build/llama.cpp/bin/llama-server'])await fs.writeFile(path.join(root,file),'',{mode:0o755});
 await validatePocRoot(root,'antares-350m');await assert.rejects(validatePocRoot(root,'antares-1b'));
 await fs.rm(path.join(root,'models/antares-350m-bf16.gguf'));
 await fs.writeFile(path.join(root,'models/antares-350m-f16.gguf'),'',{mode:0o755});
 await validatePocRoot(root,'antares-350m');
 const original=global.fetch;t.after(()=>global.fetch=original);global.fetch=async url=>String(url).endsWith('/health')?{ok:true}:{json:async()=>({})};
 const servers=new LocalServers();assert.match(await servers.start(root,'antares-350m',root,()=>{}),/independently managed/);servers.dispose();
});

test('startup passes the selected device through the real launcher for F16 and BF16 weights',async t=>{
 const {execFileSync}=require('node:child_process');
 const python=execFileSync(process.env.ANTARES_TEST_PYTHON||'python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 for(const device of ['cpu','metal'])await t.test(device,async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'antares-device-')));
  const servers=new LocalServers();t.after(async()=>{servers.dispose();await fs.rm(root,{recursive:true,force:true})});
  for(const directory of ['scripts','models','.venv/bin','build/llama.cpp/bin','vscode-extension/src'])await fs.mkdir(path.join(root,directory),{recursive:true});
  for(const script of ['serve.sh','model_profile.sh'])await fs.copyFile(path.join(__dirname,'../../scripts',script),path.join(root,'scripts',script));
  await fs.copyFile(path.join(__dirname,'../src/model-profiles.json'),path.join(root,'vscode-extension/src/model-profiles.json'));
  await fs.symlink(python,path.join(root,'.venv/bin/python'));
  await fs.writeFile(path.join(root,'models/antares-350m-f16.gguf'),'');
  if(device==='metal')await fs.writeFile(path.join(root,'models/antares-350m-bf16.gguf'),'');
  await fs.writeFile(path.join(root,'build/llama.cpp/bin/llama-server'),'#!/bin/bash\nprintf "%s\\n" "$ANTARES_DEVICE" "$@" > "$PWD/launched.txt"\nexec sleep 30\n',{mode:0o755});
  const original=global.fetch;t.after(()=>global.fetch=original);
  global.fetch=async url=>{
   if(!require('node:fs').existsSync(path.join(root,'launched.txt')))throw new Error('offline');
   return String(url).endsWith('/health')?{ok:true}:{json:async()=>({data:[{id:'antares-350m'}]})};
  };
  const prior=process.env.ANTARES_DEVICE;process.env.ANTARES_DEVICE=device==='cpu'?'metal':'cpu';
  t.after(()=>{if(prior===undefined)delete process.env.ANTARES_DEVICE;else process.env.ANTARES_DEVICE=prior});
  assert.match(await servers.start(root,'antares-350m',root,()=>{}),/Local server ready/);
  const args=(await fs.readFile(path.join(root,'launched.txt'),'utf8')).trim().split('\n');
  assert.equal(args[0],device);
  assert.equal(args[args.indexOf('--model')+1],path.join(root,`models/antares-350m-${device==='cpu'?'f16':'bf16'}.gguf`));
  assert.equal(args[args.indexOf('--gpu-layers')+1],device==='cpu'?'0':'all');
  if(device==='cpu')assert.equal(args[args.indexOf('--device')+1],'none');
  else assert.equal(args.includes('--device'),false);
 });
});
