const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const response={json:(body,options={})=>({body,status:options.status||200,headers:options.headers})};
const uid='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
function load(file,mocks={},globals={}) {
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,require:n=>mocks[n]||require(n),console,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',RESEND_API_KEY:'test'}},...globals});return module.exports;
}
function database(results) {
 const calls=[];const db={auth:{getUser:async()=>({data:{user:{id:uid}},error:null})},from:table=>{
   calls.push(table); const q={}; for(const method of ['select','eq','or','order','is','limit'])q[method]=()=>q;
   q.single=q.maybeSingle=async()=>results.shift(); return q;
 }};return {db,calls};
}
function mocks(db,user={id:uid},staff=true) {return {
 '@supabase/supabase-js':{createClient:()=>db},'next/server':{NextResponse:response},
 '@/app/lib/api-auth':{authenticate:async()=>user,hasStaffRole:async()=>staff,requireStaff:async()=>user&&staff?{user,response:null}:{user:null,response:response.json({error:'denied'},{status:user?403:401})}},
};}
test('by-user denies anonymous and another member before privileged data reads',async()=>{
 for(const [user,staff,status] of [[null,false,401],[{id:uid},false,403]]) {
   const {db,calls}=database([]);const route=load('app/api/admin/socios/by-user/route.ts',mocks(db,user,staff));
   assert.equal((await route.GET({nextUrl:new URL('https://example.invalid?id='+other)})).status,status);assert.deepEqual(calls,[]);
 }
});
test('by-user allows own profile and distinguishes missing from database failure',async()=>{
 for(const [result,status] of [[{data:{id:uid},error:null},200],[{data:null,error:null},404],[{data:null,error:{message:'offline'}},500]]) {
   const {db}=database([result]);const route=load('app/api/admin/socios/by-user/route.ts',mocks(db,{id:uid},false));
   assert.equal((await route.GET({nextUrl:new URL('https://example.invalid?id='+uid)})).status,status);
 }
});
test('self-editable user_metadata does not grant staff permission',async()=>{
 const {db}=database([{data:{rol:'socio'},error:null}]);
 const auth=load('app/lib/api-auth.ts',{'next/server':{NextResponse:response},'@/app/lib/supabase/server':{}});
 assert.equal(await auth.hasStaffRole({id:uid,user_metadata:{role:'admin'},app_metadata:{}},db),false);
});
test('cookie authentication validates user with Auth server',async()=>{
 let verified=false;
 const auth=load('app/lib/api-auth.ts',{'next/server':{NextResponse:response},'@/app/lib/supabase/server':{createClientServer:async()=>({auth:{getUser:async()=>{verified=true;return {data:{user:{id:uid}},error:null};}}})}});
 assert.equal((await auth.authenticate({headers:new Headers()},{})).id,uid);assert.equal(verified,true);
});
test('email route denies anonymous and members before reading or sending',async()=>{
 for(const user of [null,{id:uid}]) {
   const {db,calls}=database([]);const route=load('app/api/admin/cierres/send-email/route.ts',mocks(db,user,false),{fetch:()=>{throw Error('must not send');}});
   assert.equal((await route.POST({})).status,user?403:401);assert.deepEqual(calls,[]);
 }
});
const cierre={id:other,socio_id:uid,estado:'emitido',periodo:'2026-09',datos:{socio:{nombre:'<script>',apellido:'Test'},dispensas:[],aportes:[]},numero_constancia:'TEST',hash_sha256:'hash'};
test('email uses persisted recipient and escapes snapshot data, ignoring browser payload',async()=>{
 const {db}=database([{data:cierre,error:null},{data:{email:'stored@example.invalid',nombre:'<b>Test</b>',apellido:'Socio'},error:null}]);
 let sent;
 const route=load('app/api/admin/cierres/send-email/route.ts',mocks(db),{fetch:async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({id:'offline-test'})};}});
 const result=await route.POST({json:async()=>({cierreId:other,to:'attacker@example.invalid',datosCierre:{}})});
 assert.equal(result.status,200);assert.deepEqual(sent.to,['stored@example.invalid']);assert.ok(sent.html.includes('&lt;script&gt;'));assert.ok(!sent.html.includes('<script>'));
});
test('missing provider key returns failure instead of simulated success',async()=>{
 const {db}=database([{data:cierre,error:null},{data:{email:'stored@example.invalid',nombre:'Test',apellido:'Socio'},error:null}]);
 const route=load('app/api/admin/cierres/send-email/route.ts',mocks(db),{process:{env:{}},fetch:()=>{throw Error('must not send');}});
 assert.equal((await route.POST({json:async()=>({cierreId:other})})).status,503);
});
test('annulled closure is never emailed',async()=>{
 const {db}=database([{data:{...cierre,estado:'anulado'},error:null}]);
 const route=load('app/api/admin/cierres/send-email/route.ts',mocks(db),{fetch:()=>{throw Error('must not send');}});
 assert.equal((await route.POST({json:async()=>({cierreId:other})})).status,409);
});
