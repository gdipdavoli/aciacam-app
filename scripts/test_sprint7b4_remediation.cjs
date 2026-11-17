'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {spawnSync,spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),ts=createRequire(path.join(root,'package.json'))('typescript');
const loaded=new Map();
function load(file,mocks={},globals={}){
 const custom=Object.keys(mocks).length>0 || Object.keys(globals).length>0;
 if(!custom && loaded.has(file))return loaded.get(file).exports;
 const module={exports:{}};if(!custom)loaded.set(file,module);
 const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,Buffer,console,Response,Request,URL,process:{env:{}},require(name){
  if(Object.hasOwn(mocks,name))return mocks[name];
  if(name==='crypto')return crypto;
  let rel=name.startsWith('@/')?name.slice(2):name.startsWith('./')?path.posix.join(path.posix.dirname(file),name):null;
  if(!rel)throw Error('UNMOCKED_DEPENDENCY '+name);
  return load(rel+'.ts');
 },...globals},{filename:file});return module.exports;
}
const core=load('app/lib/agent/pedidos-tool-core.ts');
const {PedidosTool}=load('app/lib/agent/pedidos-tool.ts');
const {handleOrderAction}=load('app/lib/agent/order-api.ts');
const {retainOrderIntent}=load('services/orderIntent.ts');
const A='10000000-0000-4000-8000-000000000001',U='10000000-0000-4000-8000-000000000002';
const S='20000000-0000-4000-8000-000000000002',P='30000000-0000-4000-8000-000000000001';
const SECRET='synthetic-remediation-test-only-1234567890';
const params={actorUserId:A,socioId:S,tipoPedido:'retiro_sede',items:[{productoId:P,cantidad:1}],motivo:'TEST'};
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+checks+' '+name);}
function input(){return {operation:'execute_order',proposal_id:'TEST',socio_id:S,tipo_pedido:'retiro_sede',items:params.items,motivo:'TEST',idempotency_key:crypto.randomUUID(),action_grant:core.createActionGrantToken({operatorAuthUserId:A,operatorRole:'admin',targetSocioId:S,approvedPayloadHash:core.computeCanonicalOrderHash(params)},SECRET)};}
const verifier={verifyOperator:async()=>({valid:true})};
async function unit(){
 await check('F01 backend failure never becomes success',async()=>{let calls=0;const t=new PedidosTool({executionEnabled:true,secret:SECRET},{executeOrder:async()=>{calls++;throw Error('FAILED');}},verifier);const i=input();await assert.rejects(()=>t.executeOrder(i),/FAILED/);await assert.rejects(()=>t.executeOrder(i),/FAILED/);assert.equal(calls,2);});
 await check('F01 concurrent execution awaits real results',async()=>{let release;const p=new Promise(r=>release=r);const t=new PedidosTool({executionEnabled:true,secret:SECRET},{executeOrder:()=>p},verifier);const i=input();let resolved=false;const a=t.executeOrder(i),b=t.executeOrder(i).then(x=>{resolved=true;return x;});await new Promise(r=>setImmediate(r));assert.equal(resolved,false);release({success:true,pedido_id:crypto.randomUUID(),estado:'pendiente'});assert.equal((await a).pedido_id,(await b).pedido_id);});
 await check('F04 other action rejected',async()=>{const i=input();i.action_grant.payload.action='confirm_order';const t=new PedidosTool({executionEnabled:true,secret:SECRET},{executeOrder:()=>{throw Error('BYPASS');}},verifier);await assert.rejects(()=>t.executeOrder(i),/GRANT_SCOPE_MISMATCH/);});
 await check('F07 UUID case and NFC canonicalize',()=>{const p={...params,items:[{productoId:'ABCDEF00-0000-4000-8000-000000000001',cantidad:1}],motivo:'\tCafe\u0301\u00a0'};assert.equal(core.computeCanonicalOrderHash(p),core.computeCanonicalOrderHash({...p,items:[{productoId:p.items[0].productoId.toLowerCase(),cantidad:1}],motivo:'Caf\u00e9'}));});
 await check('F07 unsafe quantities rejected',()=>{for(const n of [0,-1,1.5,Infinity,NaN,2147483648])assert.throws(()=>core.consolidateOrderItems([{productoId:P,cantidad:n}]));});
 await check('F09 no-op fails original assertThrows helper',async()=>{const src=fs.readFileSync(path.join(root,'scripts/test_sprint7b4_stage2.test.ts'),'utf8');const part=src.slice(src.indexOf('async function assertThrows('),src.indexOf("console.log('======================================================================');"));const m={exports:{}};vm.runInNewContext(ts.transpileModule(part+'\nmodule.exports=assertThrows;',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:m});await assert.rejects(()=>m.exports(async()=>{},'EXPECTED','TEST'),/No se produjo/);});
 await check('F03 outbox retains key and isolates actor',()=>{const data=new Map();const s={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};const a=retainOrderIntent(s,A,{items:1},crypto.randomUUID),b=retainOrderIntent(s,A,{items:1},crypto.randomUUID);assert.equal(a.key,b.key);assert.throws(()=>retainOrderIntent(s,A,{items:2},crypto.randomUUID),/UNCERTAIN/);assert.notEqual(retainOrderIntent(s,U,{items:1},crypto.randomUUID).key,a.key);a.complete();assert.notEqual(retainOrderIntent(s,A,{items:1},crypto.randomUUID).key,a.key);});
 await check('F02 flags off prevent adapter execution',async()=>{const t=new PedidosTool({executionEnabled:false,secret:SECRET},{executeOrder:()=>{throw Error('BYPASS');}},verifier);await assert.rejects(()=>t.executeOrder(input()),/DISABLED/);});
 await check('F02 S2S cannot issue a human grant',async()=>{const r=await handleOrderAction(new Request('https://example.invalid',{method:'POST',headers:{'X-Agent-Core-Secret':SECRET,origin:'https://example.invalid'},body:'{}'}),'issue',{enabled:true,s2sSecret:SECRET,authenticate:async()=>null,admin:()=>{throw Error('BYPASS');}});assert.equal(r.status,401);});
}
const container=process.env.ACIACAM_DISPOSABLE_CONTAINER || '';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
function pg(sql,allow=false){const p=spawnSync('docker.exe',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At'],{input:sql,encoding:'utf8',timeout:30000});if(p.status!==0&&!allow)throw Error(p.stderr||String(p.error));return {status:p.status,out:p.stdout||'',err:p.stderr||''};}
function guard(){
 if(process.env.DOCKER_HOST && !/^(npipe|unix):/.test(process.env.DOCKER_HOST))throw Error('REMOTE_DOCKER_FORBIDDEN');
 const context=spawnSync('docker.exe',['context','inspect','--format','{{.Endpoints.docker.Host}}'],{encoding:'utf8'});
 assert.equal(context.status,0);assert.match(context.stdout.trim(),/^(npipe|unix):/);
 assert.match(container,/^aciacam-remediation7b4-/);
 const p=spawnSync('docker.exe',['inspect','--format','{{json .}}',container],{encoding:'utf8'});assert.equal(p.status,0);
 const d=JSON.parse(p.stdout);assert.equal(d.Config.Labels['aciacam.disposable'],'sprint7b4-remediation');assert.equal(d.HostConfig.NetworkMode,'none');assert.equal(d.Mounts.length,0);assert.ok(Object.hasOwn(d.HostConfig.Tmpfs,'/var/lib/postgresql/data'));assert.ok(!d.HostConfig.PortBindings || Object.keys(d.HostConfig.PortBindings).length===0);assert.match(pg('SHOW server_version;').out,/^17\./);assert.equal(pg("SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','auth');").out.trim(),'0');
}
function rpc(name,args,role='service_role',actor=U){
 if(!/^[a-z_]+$/.test(name))throw Error('BAD_RPC');
 const values=Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z_]+$/);return k+'=>'+(v==null?'NULL':q(typeof v==='object'?JSON.stringify(v):v));}).join(',');
 const r=pg(`BEGIN;SET LOCAL ROLE ${role};SELECT set_config('request.jwt.claim.sub',${q(actor)},true);SELECT row_to_json(x) FROM (SELECT public.${name}(${values}) AS value) x;COMMIT;`,true);
 if(r.status!==0)return {data:null,error:{code:(r.err.match(/ERROR:\s+([A-Z0-9]{5}):/)||[])[1]||'UNKNOWN'}};
 const line=r.out.split('\n').find(x=>x.startsWith('{'));return {data:JSON.parse(line).value,error:null};
}
function setup(){
 pg(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role;ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 CREATE TABLE socios(id uuid PRIMARY KEY,auth_user_id uuid,rol text,status text,bloqueado boolean DEFAULT false,motivo_bloqueo text,envios_habilitados boolean DEFAULT false);
 CREATE TABLE products(id uuid PRIMARY KEY,nombre text,activo boolean,stock_disponible integer,tipo text,peso_gramos numeric,last_audit_note text,last_audit_order_id uuid);
 CREATE TABLE pickup_slots(id uuid PRIMARY KEY,status text,capacity integer);
 CREATE TABLE pedidos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),socio_id uuid REFERENCES socios(id),items jsonb,tipo_pedido text NOT NULL CHECK(tipo_pedido IN ('delivery','retiro_sede')),origen text CHECK(origen IN ('app','admin')),estado text NOT NULL,direccion_entrega text,localidad text,fecha_retiro_preferida text,franja_horaria text,slot_id uuid REFERENCES pickup_slots(id),observaciones text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),user_id uuid,actor_socio_id uuid,action text,entity_type text,entity_id text,details jsonb,created_at timestamptz);
 INSERT INTO auth.users VALUES('${A}'),('${U}');INSERT INTO socios VALUES('20000000-0000-4000-8000-000000000001','${A}','admin','active',false,NULL,false),('${S}','${U}','socio','active',false,NULL,false);INSERT INTO products VALUES('${P}','TEST',true,100,'flor',3.5,NULL,NULL);
 ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;ALTER TABLE socios ENABLE ROW LEVEL SECURITY;ALTER TABLE products ENABLE ROW LEVEL SECURITY;`);
 const original=root;
 for(const name of ['58_atomic_stock_reservation.sql','20261016000000_order_idempotency_and_audit.sql','20261008190000_fix_sprint5_stock_trigger_rls.sql'])pg(fs.readFileSync(path.join(original,'migrations',name),'utf8'));
 const main=fs.readFileSync(path.join(root,'proposals/sprint7b4/base.sql'),'utf8');
 const lifecycle=fs.readFileSync(path.join(root,'proposals/sprint7b4/grant_lifecycle.sql'),'utf8');
 const prior=fs.readFileSync(path.join(root,'migrations/20261016000000_order_idempotency_and_audit.sql'),'utf8');
 const start=prior.indexOf('CREATE OR REPLACE FUNCTION public.confirmar_pedido_administrativo_transaccional(');
 const end=prior.indexOf('-- Permisos de ejecución para confirmación transaccional',start);
 assert.ok(start>0 && end>start);
 const confirmation=prior.slice(start,end).replace('-- A. Resolver y validar',()=>"PERFORM public.assert_order_actor(v_actor_user_id,true);\n    -- A. Resolver y validar");
 assert.ok(confirmation.includes('PERFORM public.assert_order_actor'));
 const final=main.replace(/COMMIT;\s*$/,()=>lifecycle+'\n'+confirmation+'\nREVOKE ALL ON FUNCTION public.confirmar_pedido_administrativo_transaccional(uuid,text) FROM service_role;\nCOMMIT;\n').replace(/[\t ]+$/gm,'');
 fs.writeFileSync(path.join(root,'proposals/sprint7b4/reviewed.sql'),final);
 fs.writeFileSync(path.join(root,'migrations/20261019000000_sprint7b4_delegated_execution_and_socio_checkout.sql'),final);
 pg(final);
}
async function integration(){
 guard();setup();
 const body={socio_id:S,items:params.items,tipo_pedido:'retiro_sede',motivo:'TEST',idempotency_key:crypto.randomUUID()};
 const db={rpc:async(name,args)=>rpc(name,args),from:()=>({select(){return this;},eq(_k,id){this.id=id;return this;},async maybeSingle(){return {data:JSON.parse(pg(`SELECT row_to_json(g) FROM action_grants g WHERE grant_id=${q(this.id)};`).out.trim()||'null'),error:null};}})};
 const deps={enabled:true,s2sSecret:SECRET,admin:()=>db,authenticate:async()=>({id:A,client:{rpc:async(n,a)=>rpc(n,a,'authenticated',A)}})};
 const req=b=>new Request('https://example.invalid/api/admin/pedidos',{method:'POST',headers:{'X-Agent-Core-Secret':SECRET,'X-Delegated-Auth-User-Id':b._operator_auth_user_id||A,origin:'https://example.invalid'},body:JSON.stringify(b)});
 let grant;
 await check('human BFF -> SQL issuance persists grant/audit',async()=>{const r=await handleOrderAction(req(body),'issue',deps);assert.equal(r.status,201);grant=await r.json();assert.equal(grant.operator_auth_user_id,A);assert.equal(grant.approved_payload_hash,core.computeCanonicalOrderHash(params));});
 await check('S2S -> SQL execution returns confirmed order',async()=>{const r=await handleOrderAction(req({...body,grant_id:grant.grant_id}),'execute',deps);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.equal(data.operation_state,'CONFIRMED');assert.equal(pg('SELECT stock_disponible FROM products;').out.trim(),'99');});
 await check('lost response replay returns same materialized order',async()=>{const r=await handleOrderAction(req({...body,grant_id:grant.grant_id}),'execute',deps);const d=await r.json();assert.equal(d.deduplicated,true);assert.equal(pg('SELECT count(*) FROM pedidos;').out.trim(),'1');});
 await check('wrong key rejected at BFF before RPC',async()=>{const r=await handleOrderAction(req({...body,idempotency_key:crypto.randomUUID(),grant_id:grant.grant_id}),'execute',deps);assert.equal(r.status,403);});
 await check('socio cannot issue grants',async()=>{const r=rpc('issue_order_grant',{p_socio_id:S,p_items:params.items,p_tipo_pedido:'retiro_sede',p_motivo:'TEST',p_idempotency_key:crypto.randomUUID()},'authenticated',U);assert.equal(r.error.code,'42501');});
 await check('service role cannot fabricate a grant',()=>{assert.notEqual(pg(`SET ROLE service_role;INSERT INTO action_grants SELECT * FROM action_grants;`,true).status,0);});
 await check('default function grants cannot bypass human RPC identity',()=>{
  assert.equal(rpc('crear_pedido_administrativo_transaccional',{p_socio_id:S,p_items:params.items,p_tipo_pedido:'retiro_sede',p_motivo:'TEST',p_idempotency_key:crypto.randomUUID()},'service_role',A).error.code,'42501');
  assert.equal(rpc('crear_pedido_socio_transaccional',{p_idempotency_key:crypto.randomUUID(),p_items:params.items,p_tipo_pedido:'retiro_sede'},'service_role',U).error.code,'42501');
  assert.equal(rpc('confirmar_pedido_administrativo_transaccional',{p_pedido_id:crypto.randomUUID()},'service_role',A).error.code,'42501');
 });
 await check('suspended admin rejected',()=>{pg(`UPDATE socios SET status='suspended' WHERE auth_user_id='${A}';`);const r=rpc('crear_pedido_administrativo_transaccional',{p_socio_id:S,p_items:params.items,p_tipo_pedido:'retiro_sede',p_motivo:'TEST',p_idempotency_key:crypto.randomUUID()},'authenticated',A);assert.equal(r.error.code,'42501');pg(`UPDATE socios SET status='active' WHERE auth_user_id='${A}';`);});
 await check('delivery disabled rejects grant issuance',()=>{const r=rpc('issue_order_grant',{p_socio_id:S,p_items:params.items,p_tipo_pedido:'delivery',p_motivo:'TEST',p_idempotency_key:crypto.randomUUID(),p_details:{direccion_entrega:'TEST',localidad:'TEST'}},'authenticated',A);assert.ok(r.error);});
 await check('snapshot cannot be changed after approval',()=>{assert.notEqual(pg("UPDATE action_grants SET approved_payload_hash=repeat('0',64);",true).status,0);});
 await check('human revocation preserves original execution',async()=>{const r=await handleOrderAction(req({grant_id:grant.grant_id,reason:'TEST'}),'revoke',deps);assert.equal(r.status,200);assert.equal(pg('SELECT count(*) FROM pedidos;').out.trim(),'1');const again=await handleOrderAction(req({...body,grant_id:grant.grant_id}),'execute',deps);assert.equal(again.status,409);});
 await check('direct authenticated checkout has own actor and replay',()=>{const args={p_idempotency_key:crypto.randomUUID(),p_items:params.items,p_tipo_pedido:'retiro_sede'};const a=rpc('crear_pedido_socio_transaccional',args,'authenticated',U),b=rpc('crear_pedido_socio_transaccional',args,'authenticated',U);assert.equal(a.data.pedido.socio_id,S);assert.equal(a.data.pedido.id,b.data.pedido.id);});
 await check('preflight refuses a second installation',()=>{const sql=fs.readFileSync(path.join(root,'proposals/sprint7b4/reviewed.sql'),'utf8');assert.match(pg(sql,true).err,/PREFLIGHT_ACTION_GRANTS_ALREADY_EXISTS/);});
 await check('approved catalogue change is fail-closed',async()=>{
  const b={...body,idempotency_key:crypto.randomUUID()};const g=await (await handleOrderAction(req(b),'issue',deps)).json();
  pg('UPDATE products SET peso_gramos=4;');
  const r=await handleOrderAction(req({...b,grant_id:g.grant_id}),'execute',deps);assert.equal(r.status,409);
  pg('UPDATE products SET peso_gramos=3.5;');
 });
 await check('shared JS PG17 golden vectors',()=>{
  for(const text of ['TEST','\tCafe\u0301\u00a0','\u3000I\u0130\u0131\uFEFF']) {
   const hash=rpc('issue_order_grant',{p_socio_id:S,p_items:params.items,p_tipo_pedido:'retiro_sede',p_motivo:text,p_idempotency_key:crypto.randomUUID()},'authenticated',A);
   assert.equal(hash.data.approved_payload_hash,core.computeCanonicalOrderHash({...params,motivo:text}));
  }
 });
 await check('response lost after SQL commit recovers one real order',async()=>{
  const b={...body,idempotency_key:crypto.randomUUID()};const g=await (await handleOrderAction(req(b),'issue',deps)).json();
  const lossy={...deps,admin:()=>({...db,rpc:async(n,a)=>{const result=rpc(n,a);return n==='ejecutar_pedido_con_autorizacion_delegada'&&!result.error?{data:null,error:{code:'NETWORK_LOST'}}:result;}})};
  const first=await handleOrderAction(req({...b,grant_id:g.grant_id}),'execute',lossy);assert.equal(first.status,502);
  const second=await handleOrderAction(req({...b,grant_id:g.grant_id}),'execute',deps);const result=await second.json();assert.equal(second.status,200);assert.equal(result.deduplicated,true);
  assert.equal(pg(`SELECT count(*) FROM pedidos WHERE idempotency_key=${q(b.idempotency_key)};`).out.trim(),'1');
  assert.match(pg(`SELECT string_agg(status,',' ORDER BY created_at) FROM order_execution_attempts WHERE grant_id=${q(g.grant_id)};`).out,/UNCERTAIN,CONFIRMED/);
 });
 await check('failure before SQL commit stays uncertain without false order',async()=>{
  const b={...body,idempotency_key:crypto.randomUUID()};const g=await (await handleOrderAction(req(b),'issue',deps)).json();
  const failing={...deps,admin:()=>({...db,rpc:async(n,a)=>{if(n==='ejecutar_pedido_con_autorizacion_delegada')throw Error('SYNTHETIC_NETWORK');return rpc(n,a);}})};
  const r=await handleOrderAction(req({...b,grant_id:g.grant_id}),'execute',failing);assert.equal(r.status,502);
  assert.equal(pg(`SELECT count(*) FROM pedidos WHERE idempotency_key=${q(b.idempotency_key)};`).out.trim(),'0');
  assert.equal(rpc('read_order_execution_status',{p_grant_id:g.grant_id,p_actor:A}).data,'UNCERTAIN');
 });
 await check('attempt cannot fabricate a confirmed result',()=>{
  const key=crypto.randomUUID(),g=rpc('issue_order_grant',{p_socio_id:S,p_items:params.items,p_tipo_pedido:'retiro_sede',p_motivo:'TEST',p_idempotency_key:key},'authenticated',A).data;
  const id=crypto.randomUUID();assert.ok(!rpc('record_order_attempt',{p_grant_id:g.grant_id,p_key:key,p_attempt_id:id,p_state:'PENDING'}).error);
  assert.ok(rpc('record_order_attempt',{p_grant_id:g.grant_id,p_key:key,p_attempt_id:id,p_state:'CONFIRMED'}).error);
 });
 await check('SQL checks the bound key independently of BFF',()=>{
  const wrong=pg(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ejecutar_pedido_con_autorizacion_delegada('${grant.grant_id}','${crypto.randomUUID()}','${S}',${q(JSON.stringify(params.items))}::jsonb,'retiro_sede','TEST');ROLLBACK;`,true);
  assert.match(wrong.err,/GRANT_SCOPE_MISMATCH/);
 });
 await check('expired grant rejected in PostgreSQL',()=>{
  const id=crypto.randomUUID(),key=crypto.randomUUID(),hash=core.computeCanonicalOrderHash(params);
  pg(`INSERT INTO action_grants(grant_id,operator_auth_user_id,target_socio_id,approved_payload_hash,idempotency_key,status,issued_at,expires_at,approved_catalogue_hash) VALUES('${id}','${A}','${S}','${hash}','${key}','issued',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '1 second',public.order_catalogue_hash(${q(JSON.stringify(params.items))}::jsonb));`);
  const r=rpc('ejecutar_pedido_con_autorizacion_delegada',{p_grant_id:id,p_idempotency_key:key,p_socio_id:S,p_items:params.items,p_tipo_pedido:'retiro_sede',p_motivo:'TEST'});assert.equal(r.error.code,'42501');
 });
 await check('confirmed execution recovers after expiry without a new write',()=>{
  const id=crypto.randomUUID(),key=crypto.randomUUID(),hash=core.computeCanonicalOrderHash(params);
  pg(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS t) INSERT INTO action_grants(grant_id,operator_auth_user_id,target_socio_id,approved_payload_hash,idempotency_key,status,issued_at,expires_at,approved_catalogue_hash) SELECT '${id}','${A}','${S}','${hash}','${key}','issued',t,t+interval '3 seconds',public.order_catalogue_hash(${q(JSON.stringify(params.items))}::jsonb) FROM stamp;`);
  const args={p_grant_id:id,p_idempotency_key:key,p_socio_id:S,p_items:params.items,p_tipo_pedido:'retiro_sede',p_motivo:'TEST'};
  const first=rpc('ejecutar_pedido_con_autorizacion_delegada',args);assert.ok(first.data?.pedido_id);
  const before=pg('SELECT count(*) FROM pedidos;SELECT stock_disponible FROM products;').out;
  pg('SELECT pg_sleep(3.1);');const again=rpc('ejecutar_pedido_con_autorizacion_delegada',args);
  assert.equal(again.data.pedido_id,first.data.pedido_id);assert.equal(again.data.deduplicated,true);
  assert.equal(pg('SELECT count(*) FROM pedidos;SELECT stock_disponible FROM products;').out,before);
 });
 await check('callback actor cannot impersonate the approving operator',async()=>{
  const request=new Request('https://example.invalid/api/admin/pedidos',{method:'POST',headers:{'X-Agent-Core-Secret':SECRET,'X-Delegated-Auth-User-Id':U},body:JSON.stringify({...body,grant_id:grant.grant_id})});
  const r=await handleOrderAction(request,'execute',deps);assert.equal(r.status,403);assert.equal((await r.json()).code,'GRANT_ACTOR_MISMATCH');
 });
 await check('human can inspect grant with execution flags OFF',async()=>{
  const r=await handleOrderAction(new Request('https://example.invalid/api/admin/pedidos/grants?grant_id='+grant.grant_id),'human-status',{...deps,enabled:false});
  assert.equal(r.status,200);const d=await r.json();assert.equal(d.grant_id,grant.grant_id);assert.ok(d.pedido_id);
 });
 await check('forged human actor fields rejected before issuance',async()=>{
  const r=await handleOrderAction(req({...body,idempotency_key:crypto.randomUUID(),actor_id:U}),'issue',deps);assert.equal(r.status,400);
 });
 await check('audit failure rolls back order and stock',()=>{
  pg("CREATE FUNCTION public.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST_AUDIT_FAILURE';END$$;CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.test_audit_failure();");
  const before=pg('SELECT count(*) FROM pedidos;SELECT stock_disponible FROM products;').out;
  const r=rpc('crear_pedido_socio_transaccional',{p_idempotency_key:crypto.randomUUID(),p_items:params.items,p_tipo_pedido:'retiro_sede'},'authenticated',U);assert.ok(r.error);
  assert.equal(pg('SELECT count(*) FROM pedidos;SELECT stock_disponible FROM products;').out,before);
  pg('DROP TRIGGER test_audit_failure ON audit_logs;DROP FUNCTION public.test_audit_failure();');
 });
 function session(sql){return new Promise(resolve=>{const p=spawn('docker.exe',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']);let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('close',status=>resolve({status,out,err}));p.stdin.end(sql);});}
 const command=(key,slot=null)=>`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${U}',true);SELECT public.crear_pedido_socio_transaccional('${key}',${q(JSON.stringify(params.items))}::jsonb,'retiro_sede',NULL,NULL,NULL,NULL,${slot?q(slot):'NULL'});COMMIT;`;
 await check('two concurrent same-key sessions create one order',async()=>{
  const key=crypto.randomUUID(),r=await Promise.all([session(command(key)),session(command(key))]);assert.ok(r.every(x=>x.status===0));assert.equal(pg(`SELECT count(*) FROM pedidos WHERE idempotency_key='${key}';`).out.trim(),'1');
 });
 await check('last stock unit cannot be oversold concurrently',async()=>{
  pg('UPDATE products SET stock_disponible=1;');const r=await Promise.all([session(command(crypto.randomUUID())),session(command(crypto.randomUUID()))]);assert.equal(r.filter(x=>x.status===0).length,1);assert.equal(pg('SELECT stock_disponible FROM products;').out.trim(),'0');pg('UPDATE products SET stock_disponible=100;');
 });
 await check('pickup capacity survives concurrent sessions',async()=>{
  const slot=crypto.randomUUID();pg(`INSERT INTO pickup_slots VALUES('${slot}','active',1);`);
  const r=await Promise.all([session(command(crypto.randomUUID(),slot)),session(command(crypto.randomUUID(),slot))]);assert.equal(r.filter(x=>x.status===0).length,1);assert.match(r.find(x=>x.status!==0).err,/SLOT_CAPACITY_EXCEEDED/);
 });
 await check('cancellation restores stock once without changing Stock58',()=>{
  const key=crypto.randomUUID();const r=rpc('crear_pedido_socio_transaccional',{p_idempotency_key:key,p_items:params.items,p_tipo_pedido:'retiro_sede'},'authenticated',U);assert.ok(r.data?.pedido.id);
  const before=Number(pg('SELECT stock_disponible FROM products;').out.trim());
  pg(`BEGIN;SELECT set_config('request.jwt.claim.sub','${U}',true);UPDATE pedidos SET estado='cancelado' WHERE id='${r.data.pedido.id}';UPDATE pedidos SET estado='cancelado' WHERE id='${r.data.pedido.id}';COMMIT;`);
  assert.equal(Number(pg('SELECT stock_disponible FROM products;').out.trim()),before+1);
 });
 await check('simultaneous cancellations restore stock exactly once',async()=>{
  const r=rpc('crear_pedido_socio_transaccional',{p_idempotency_key:crypto.randomUUID(),p_items:params.items,p_tipo_pedido:'retiro_sede'},'authenticated',U);assert.ok(r.data?.pedido.id);
  const before=Number(pg('SELECT stock_disponible FROM products;').out.trim());
  // Exercise Stock58 triggers, not a new cancellation API or synthetic RLS policy.
  const sql=`BEGIN;SELECT set_config('request.jwt.claim.sub','${U}',true);UPDATE pedidos SET estado='cancelado' WHERE id='${r.data.pedido.id}';COMMIT;`;
  const results=await Promise.all([session(sql),session(sql)]);assert.ok(results.every(x=>x.status===0));
  assert.equal(Number(pg('SELECT stock_disponible FROM products;').out.trim()),before+1);
 });
 await check('pickup disabled after human approval is fail-closed',async()=>{
  const slot=crypto.randomUUID();pg(`INSERT INTO pickup_slots VALUES('${slot}','active',1);`);
  const b={...body,idempotency_key:crypto.randomUUID(),slot_id:slot};
  const issued=await handleOrderAction(req(b),'issue',deps);assert.equal(issued.status,201);const g=await issued.json();assert.ok(g.grant_id);
  pg(`UPDATE pickup_slots SET status='inactive' WHERE id='${slot}';`);
  const r=await handleOrderAction(req({...b,grant_id:g.grant_id}),'execute',deps);assert.notEqual(r.status,200);
  assert.equal(pg(`SELECT count(*) FROM pedidos WHERE idempotency_key='${b.idempotency_key}';`).out.trim(),'0');
 });
 await check('real checkout client -> Next handler -> SQL survives lost response',async()=>{
  const next=createRequire(path.join(root,'package.json'))('next/server');
  const auth={success:true,id:U,user:{id:U},userClient:{rpc:async(n,a)=>rpc(n,a,'authenticated',U)},authResponse:null};
  const route=load('app/api/pedidos/route.ts',{'next/server':next,'@supabase/supabase-js':{createClient:()=>({})},
    '@/app/lib/agent/order-auth':{authenticate:async()=>auth},'@/app/lib/supabase/auth-response':{preserveSupabaseAuthResponse:r=>r}});
  const state=new Map(),storage={getItem:k=>state.get(k)||null,setItem:(k,v)=>state.set(k,v),removeItem:k=>state.delete(k)};
  let drop=true,key;
  const service=load('services/storeService.ts',{'./supabaseClient':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:U},access_token:'SYNTHETIC_NOT_A_CREDENTIAL'}}})}}},'./documentacionService':{},'./linkedProfile':{}},
    {window:{sessionStorage:storage,localStorage:storage},process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid'}},crypto:{randomUUID:crypto.randomUUID},
     fetch:async(_url,options)=>{key=options.headers['Idempotency-Key'];const response=await route.POST(new next.NextRequest('https://example.invalid/api/pedidos',{...options,headers:{...options.headers,origin:'https://example.invalid'}}));if(drop){drop=false;throw Error('SYNTHETIC_LOST_RESPONSE');}return response;}}).StoreService;
  const items=[{productoId:P,cantidad:1,productoNombre:'TEST'}];
  await assert.rejects(()=>service.createPedido(S,items,'retiro_sede',{}),/LOST_RESPONSE/);
  const firstKey=key,result=await service.createPedido(S,items,'retiro_sede',{});assert.ok(result.id);assert.equal(firstKey,key);
  assert.equal(pg(`SELECT count(*) FROM pedidos WHERE idempotency_key=${q(key)};`).out.trim(),'1');
  assert.equal(state.size,0);
 });
 if(process.env.ACIACAM_TEST_PYTHON) await check('Next BFF dispatch -> Python ASGI/orchestrator -> callback BFF -> PG17/agent_runs',async()=>{
  pg('CREATE TABLE agent_runs(id uuid DEFAULT gen_random_uuid(),agent text,input text,output text,duration_ms integer,status text);');
  const b={...body,idempotency_key:crypto.randomUUID()};
  const g=await (await handleOrderAction(req(b),'issue',deps)).json();assert.ok(g.grant_id);
  const bridge=(payload,actor,role,secret)=>new Promise((resolve,reject)=>{
   const coreRoot=process.env.ACIACAM_CORE_DIR || (fs.existsSync(path.resolve(root,'../sprint7b4-remediation-core')) ? path.resolve(root,'../sprint7b4-remediation-core') : path.resolve('C:/Users/gdipd/.gemini/aciacam-agent-core'));
   const worker=path.resolve(coreRoot,'scripts/delegated_order_local_worker.py');
   const p=spawn(process.env.ACIACAM_TEST_PYTHON,['-B',worker]);let buffer='',last,errors='';
   const timer=setTimeout(()=>{p.kill();reject(Error('LOCAL_WORKER_TIMEOUT'));},30000);
   p.stderr.on('data',v=>errors+=v);
   p.stdout.on('data',async v=>{buffer+=v;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.startsWith('{'))continue;
    try{const msg=JSON.parse(line);if(msg.type==='result'){last=msg.payload;continue;}
     if(msg.type==='audit'){
      const row=msg.payload;pg(`INSERT INTO agent_runs(agent,input,output,duration_ms,status) VALUES(${q(row.agent)},${q(row.input)},${q(row.output)},${Number(row.duration_ms)},${q(row.status)});`);
      p.stdin.write('{}\n');continue;
     }
     assert.ok(msg.type==='call');const action=msg.path.endsWith('validate')?'validate':msg.path.endsWith('status')?'status':'execute';
     const request=msg.method==='GET'?new Request('https://example.invalid?'+new URLSearchParams(msg.payload),{headers:{'X-Agent-Core-Secret':SECRET,'X-Delegated-Auth-User-Id':msg.payload._operator_auth_user_id}}):req(msg.payload);
     const response=await handleOrderAction(request,action,deps);p.stdin.write(JSON.stringify(await response.json())+'\n');
    }catch(e){p.kill();reject(e);}
   }});
   p.on('close',code=>{clearTimeout(timer);if(code===0&&last)resolve(last);else reject(Error(errors||'WORKER_FAILED'));});
   p.stdin.write(JSON.stringify({request:payload,authenticated_test_actor:actor,authenticated_test_role:role,s2s_secret:secret})+'\n');
  });
  const next=createRequire(path.join(root,'package.json'))('next/server');
  const dispatch=load('app/api/admin/pedidos/dispatch/route.ts',{'next/server':next,'@/app/lib/agent/bff-auth':{
    getDelegatedBffContext:async()=>({success:true,context:{agentCoreBaseUrl:'https://test.invalid',s2sHeaders:{'X-Agent-Core-Secret':'SYNTHETIC_LOCAL_ASGI_TEST_SECRET_NOT_PRODUCTION','X-Delegated-Auth-User-Id':A,'X-Delegated-User-Role':'admin'}}}),withBffAuthResponse:(_a,r)=>r}},
    {AbortSignal,process:{env:{AGENT_CORE_ENABLED:'true',AGENT_ORDER_EXECUTION_ENABLED:'true'}},fetch:async(url,options)=>{
      assert.equal(url,'https://test.invalid/api/v1/orchestration/delegated-order');
      const result=await bridge(JSON.parse(options.body),options.headers['X-Delegated-Auth-User-Id'],options.headers['X-Delegated-User-Role'],options.headers['X-Agent-Core-Secret']);
      assert.equal(options.signal.aborted,false);return Response.json(result);
    }});
  const response=await dispatch.POST(new next.NextRequest('https://example.invalid/api/admin/pedidos/dispatch',{method:'POST',headers:{origin:'https://example.invalid'},body:JSON.stringify({...b,grant_id:g.grant_id})}));
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.operation_state,'CONFIRMED');assert.equal(result.grant_id,g.grant_id);
  assert.equal(pg(`SELECT count(*) FROM agent_runs WHERE input=${q(g.correlation_id)};`).out.trim(),'1');
  assert.equal(pg(`SELECT count(*) FROM audit_logs WHERE details->>'correlation_id'=${q(g.correlation_id)};`).out.trim(),'2');
 });
}
(async()=>{await unit();if(process.argv.includes('--pg'))await integration();console.log('TOTAL_PASS='+checks);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
