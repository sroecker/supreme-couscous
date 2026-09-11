const {test}=require('node:test');const assert=require('node:assert/strict');
const {setDecision,decision,counts,invalidateDecision,nextPending}=require('../dist/review-model');
const make=()=>({target:'/tmp',started:'now',report:{findings:[{file_path:'one.py'},{file_path:'two.py'}]}});
test('review decisions and next candidate preserve separate execution state',()=>{
 const run=make();run.status='incomplete';assert.deepEqual(counts(run),{unreviewed:2,confirmed:0,dismissed:0});
 setDecision(run,0,'confirmed','checked the query','hash');assert.equal(nextPending(run,0),1);
 assert.equal(run.status,'incomplete');assert.equal(counts(run).confirmed,1);
 setDecision(run,1,'dismissed','middleware checks it','hash');assert.equal(counts(run).unreviewed,0);
 setDecision(run,0,'unreviewed','need more context');assert.equal(counts(run).unreviewed,1);
});
test('dismissal needs a reason and invalid messages do not alter state',()=>{
 const run=make();assert.throws(()=>setDecision(run,0,'dismissed','   '));assert.throws(()=>setDecision(run,8,'confirmed','x'));
 assert.throws(()=>setDecision(run,0,'safe','x'));assert.throws(()=>setDecision(run,0,'confirmed',undefined));
 assert.equal(counts(run).unreviewed,2);
});
test('changed or missing source reopens review and retains notes',()=>{
 const run=make();setDecision(run,0,'confirmed','evidence','original');
 assert.equal(invalidateDecision(run,0,'original'),false);assert.equal(invalidateDecision(run,0,'changed'),true);
 assert.equal(decision(run,0).status,'unreviewed');assert.equal(decision(run,0).note,'evidence');assert.equal(run.sourceChanged,true);
});
test('HTML escapes model content and notes',()=>{
 const {escapeHtml}=require('../dist/review-model');assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
