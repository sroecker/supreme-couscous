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
 const original=global.fetch;t.after(()=>global.fetch=original);global.fetch=async url=>String(url).endsWith('/health')?{ok:true}:{json:async()=>({})};
 const servers=new LocalServers();assert.match(await servers.start(root,'antares-350m',root,()=>{}),/independently managed/);servers.dispose();
});
