const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RunStore, ConflictError, workspaceKey } = require('../dist/store');
function run(target) { return {target,model:'antares-350m',cwe:'CWE-89',status:'completed',started:new Date().toISOString(),finished:new Date().toISOString(),report:{metadata:{model:'antares-350m'},summary:{generation_errors:0,failed_workers:0},findings:[{file_path:'app.py',cwe_ids:['CWE-89'],title:'candidate'}]},drafts:{0:{note:'unsaved decision draft',updated:'now'}}}; }
async function fixture(t) { const base=await fs.mkdtemp(path.join(os.tmpdir(),'antares-store-'));t.after(()=>fs.rm(base,{recursive:true,force:true})); return base; }
test('workspace identity is canonical-order independent and multi-root specific',()=>{
 assert.equal(workspaceKey(['/a','/b']),workspaceKey(['/b','/a']));assert.notEqual(workspaceKey(['/a']),workspaceKey(['/a','/b']));
});
test('separate projects and independent runs retain drafts and decisions',async t=>{
 const base=await fixture(t), a=new RunStore(base,['/a']),b=new RunStore(base,['/b']);const first=run('/a/source'),second=run('/b/source');
 await Promise.all([a.save(first),b.save(second)]); await a.save(run('/a/other'));
 assert.equal((await a.list()).length,2);assert.equal((await b.list()).length,1);assert.equal((await a.list()).find(r=>r.id===first.id).drafts[0].note,'unsaved decision draft');
});
test('independent stores reject conflicting revisions without losing durable data',async t=>{
 const base=await fixture(t),a=new RunStore(base,['/a']),b=new RunStore(base,['/a']);const r=run('/a');await a.save(r);
 const x=structuredClone(r),y=structuredClone(r);x.drafts[0].note='window A';y.drafts[0].note='window B';
 const results=await Promise.allSettled([a.save(x),b.save(y)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.find(r=>r.status==='rejected').reason instanceof ConflictError);
 assert.ok(['window A','window B'].includes((await a.list())[0].drafts[0].note));assert.equal(y.drafts[0].note,'window B');
});
test('migration is idempotent and leaves the legacy file untouched',async t=>{
 const base=await fixture(t),legacy=run('/a');await fs.writeFile(path.join(base,'last-result.json'),JSON.stringify(legacy));
 const a=new RunStore(base,['/a']),b=new RunStore(base,['/b']);await a.migrate();const r=(await a.list())[0];r.drafts[0].note='newer';await a.save(r);await a.migrate();await b.migrate();
 assert.equal((await a.list()).length,1);assert.equal((await a.list())[0].drafts[0].note,'newer');assert.equal((await b.list()).length,0);assert.deepEqual(JSON.parse(await fs.readFile(path.join(base,'last-result.json'),'utf8')),legacy);
});
test('corrupt record does not hide other history or get overwritten',async t=>{
 const base=await fixture(t),store=new RunStore(base,['/a']),r=run('/a');await store.save(r);const filename=path.join(store.directory,`${r.id}.json`);await fs.writeFile(filename,'{');await store.save(run('/a/another'));
 assert.equal((await store.list()).length,1);await assert.rejects(store.save(r));assert.equal(await fs.readFile(filename,'utf8'),'{');assert.equal(r.drafts[0].note,'unsaved decision draft');
});
test('failed atomic replacement preserves the previous record and local draft',async t=>{
 const base=await fixture(t),store=new RunStore(base,['/a']),r=run('/a');await store.save(r);const revision=r.revision;r.drafts[0].note='not yet durable';
 const original=fs.rename;t.mock.method(fs,'rename',async()=>{throw Object.assign(new Error('simulated write failure'),{code:'EIO'})});
 await assert.rejects(store.save(r),/simulated write failure/);assert.equal(r.revision,revision);assert.equal(r.drafts[0].note,'not yet durable');
 assert.equal((await store.list())[0].drafts[0].note,'unsaved decision draft');t.mock.restoreAll();assert.equal(fs.rename,original);
 await store.save(r);assert.equal((await store.list())[0].drafts[0].note,'not yet durable');
});
test('known dead-owner locks are reclaimed without losing the prior revision',async t=>{
 const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','']);await new Promise(resolve=>child.on('close',resolve));
 const base=await fixture(t),store=new RunStore(base,['/a']),r=run('/a');await store.save(r);
 await fs.writeFile(path.join(store.directory,`${r.id}.json.lock`),String(child.pid));await store.save(r);assert.equal(r.revision,2);
});
