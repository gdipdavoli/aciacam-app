const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const moduleUnderTest={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../services/linkedProfile.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
 {module:moduleUnderTest,exports:moduleUnderTest.exports,AbortController,setTimeout,clearTimeout,fetch});
const {fetchLinkedProfile}=moduleUnderTest.exports;
test('only a confirmed missing profile returns undefined',async()=>{
 assert.equal(await fetchLinkedProfile('test',async()=>({status:404})),undefined);
 for(const status of [401,403,500,503]) await assert.rejects(fetchLinkedProfile('test',async()=>({status,ok:false})),/verificar/);
 await assert.rejects(fetchLinkedProfile('test',async()=>{throw new Error('offline')}),/offline/);
});
test('loads one profile request with credentials, cancellation and no document waterfall',async()=>{
 let calls=0;
 const profile=await fetchLinkedProfile('test',async(url,opts)=>{
  calls++;assert.match(url,/by-user/);assert.equal(opts.credentials,'same-origin');assert.equal(opts.cache,'no-store');assert.ok(opts.signal);
  return {ok:true,json:async()=>({id:'member'})};
 });
 assert.equal(profile.id,'member');assert.equal(calls,1);
 await assert.rejects(fetchLinkedProfile('test',async()=>({ok:true,json:async()=>({})})),/incompleta/);
});
