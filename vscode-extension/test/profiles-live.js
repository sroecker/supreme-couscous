// Explicitly opt-in local inference evaluation; never part of npm test.
const fs=require('node:fs/promises'),path=require('node:path');
const {profile,scanProfiles,explicitSweepRequest,runCli,childEnvironment,cliReport,isComplete}=require('../dist/core');
async function main(){
 const root=path.resolve(__dirname,'../..'),output=path.join(root,'logs/profiles-0.4.0');await fs.mkdir(output,{recursive:true});
 const oauth=JSON.parse(await fs.readFile(path.join(root,'examples/fastmcp-oauth/cases.json'),'utf8'));
 const cases=[{id:'sql-demo',target:'examples/demo',scanProfile:'web',cwe:'CWE-89',expected:['app.py']},...oauth.flatMap(c=>['vulnerable','fixed'].map(v=>({id:`${c.id}-${v}`,target:`examples/fastmcp-oauth/${c.id}/${v}`,scanProfile:'oauth',cwe:c.cwe,expected:v==='vulnerable'?['server.py']:[]})))];
 const results=JSON.parse(await fs.readFile(path.join(output,'summary.json'),'utf8').catch(()=> '[]')); 
 for(const model of process.argv.slice(2).length?process.argv.slice(2):['antares-350m','antares-1b']){
  for(const c of cases){
   if(results.some(r=>r.model===model&&r.id===c.id)){console.log(`Retaining existing ${model}/${c.id}`);continue;}
   const connection=profile(model),request=explicitSweepRequest(path.join(root,c.target),connection,10,scanProfiles[c.scanProfile].categories);
   const started=Date.now();const result=await runCli(path.join(root,'.venv/bin/antares'),['tool','sweep','--stdin'],request.payload,output,childEnvironment(path.join(output,'history')),900000,new AbortController().signal);
   let report,error;try{report=cliReport(result)}catch(e){error=e.message}
   const complete=!result.stopped&&report&&isComplete(report,result.exitCode);
   const actual=[...new Set((report?.findings??[]).filter(f=>f.cwe_ids.includes(c.cwe)).map(f=>f.file_path))].sort();
   const row={...c,model,complete:!!complete,exitCode:result.exitCode,stopped:result.stopped,error,durationSeconds:(Date.now()-started)/1000,actual,matchesExpected:complete?JSON.stringify(actual)===JSON.stringify(c.expected):null,report};
   results.push(row);await fs.writeFile(path.join(output,`${model}-${c.id}.json`),JSON.stringify(row,null,2));await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(results,null,2));
   console.log(JSON.stringify({model,case:c.id,complete:!!complete,actual,failed:report?.summary.failed_workers,seconds:row.durationSeconds}));
  }
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
