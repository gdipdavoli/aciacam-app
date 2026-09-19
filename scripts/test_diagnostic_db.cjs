const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '../../diagnostic-validation/node_modules/@electric-sql/pglite');
const db = new PGlite();
const admin='00000000-0000-4000-8000-000000000001';
const member='00000000-0000-4000-8000-000000000002';
const product='00000000-0000-4000-8000-000000000003';
const order='00000000-0000-4000-8000-000000000004';
const item=n=>JSON.stringify([{productoId:product,cantidad:n}]);
let count=0;
async function check(name, fn) { await fn(); count++; console.log('PASS '+name); }
async function stock(n) { assert.equal((await db.query('select stock_disponible from products')).rows[0].stock_disponible,n); }
async function fail(sql, values, pattern) { await assert.rejects(db.query(sql,values),pattern); }

(async()=>{
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('role',nullif(current_setting('request.jwt.claim.role',true),'')) $$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
 CREATE TABLE socios(id uuid PRIMARY KEY,auth_user_id uuid,user_id uuid,rol text,bloqueado boolean DEFAULT false);
 CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT rol FROM public.socios WHERE auth_user_id=auth.uid() OR user_id=auth.uid() LIMIT 1 $$;
 CREATE TABLE products(id uuid PRIMARY KEY,nombre text,stock_disponible int,last_audit_note text,last_audit_order_id uuid);
 CREATE TABLE pedidos(id uuid PRIMARY KEY,socio_id uuid REFERENCES socios(id),items jsonb,estado text);
 CREATE TABLE pagos(id uuid DEFAULT gen_random_uuid(),socio_id uuid,fecha timestamptz,concepto text,monto numeric,medio_de_pago text,pedido_id uuid,referencia text,created_by uuid);
 CREATE TABLE audit_logs(user_id uuid,action text,entity_type text,entity_id text,details jsonb,created_at timestamptz);
 GRANT SELECT,INSERT,UPDATE ON socios,pedidos,pagos,audit_logs TO authenticated;
 GRANT SELECT ON products TO authenticated;
 ALTER TABLE products ENABLE ROW LEVEL SECURITY;
 CREATE POLICY product_read ON products FOR SELECT TO authenticated USING(true);
 INSERT INTO socios(id,auth_user_id,user_id,rol) VALUES('${admin}','${admin}','${admin}','admin'),('${member}','${member}','${member}','socio');
 INSERT INTO products(id,nombre,stock_disponible) VALUES('${product}','Producto ficticio',10);
 `);
 for(const file of ['20260919071608_diagnostic_critical_guards.sql','20260919071729_atomic_order_stock.sql']) {
   await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 }
 await db.exec(`set request.jwt.claim.sub='${member}'; set request.jwt.claim.role='authenticated'; set role authenticated;`);
 await check('member cannot grant themselves staff access',()=>fail(`update socios set rol='admin' where id=$1`,[member],/permisos/));
 await check('member cannot change linked identity',()=>fail(`update socios set auth_user_id=$1 where id=$2`,[admin,member],/permisos/));
 await check('member order reserves inventory without direct product UPDATE rights',async()=>{
   await db.query('insert into pedidos values($1,$2,$3,$4)',[order,member,item(3),'pendiente']); await stock(7);
 });
 await check('delivery does not deduct a second time',async()=>{await db.query("update pedidos set estado='entregado' where id=$1",[order]);await stock(7);});
 await check('cancellation of delivered order returns stock as requested',async()=>{await db.query("update pedidos set estado='cancelado' where id=$1",[order]);await stock(10);});
 await check('repeated cancellation returns stock only once',async()=>{await db.query("update pedidos set estado='cancelado' where id=$1",[order]);await stock(10);});
 await check('reactivation reserves stock once',async()=>{await db.query("update pedidos set estado='pendiente' where id=$1",[order]);await stock(7);});
 await check('item editing applies the net difference',async()=>{await db.query('update pedidos set items=$1 where id=$2',[item(5),order]);await stock(5);});
 await check('insufficient stock rolls back the whole change',async()=>{await fail('update pedidos set items=$1 where id=$2',[item(11),order],/Stock insuficiente/);await stock(5);});
 await check('negative and fractional quantities are rejected',async()=>{for(const n of [-1,0,1.5])await fail('update pedidos set items=$1 where id=$2',[item(n),order],/entera positiva/);await stock(5);});
 await check('duplicate product lines cannot oversell',async()=>{await fail('update pedidos set items=$1 where id=$2',[JSON.stringify([{productoId:product,cantidad:6},{productoId:product,cantidad:6}]),order],/Stock insuficiente/);await stock(5);});
 const pay=JSON.stringify([{monto:100,medio_de_pago:'efectivo',concepto:'Prueba'}]);
 await check('member cannot invoke privileged payment confirmation',()=>fail('select confirm_order_and_payments($1,$2,$3,$4)',[order,'entregado',pay,admin],/No autorizado/));
 await db.exec(`reset role; set request.jwt.claim.sub=''; set request.jwt.claim.role='anon'; set role anon;`);
 await check('anonymous execution permission is revoked',()=>fail('select confirm_order_and_payments($1,$2,$3,$4)',[order,'entregado',pay,admin],/permission denied/));
 await db.exec(`reset role; set request.jwt.claim.sub='${admin}'; set request.jwt.claim.role='authenticated'; set role authenticated;`);
 await check('payment retry creates one payment and uses the authenticated actor',async()=>{
   await db.query('select confirm_order_and_payments($1,$2,$3,$4)',[order,'entregado',pay,member]);
   await db.query('select confirm_order_and_payments($1,$2,$3,$4)',[order,'entregado',pay,member]);
   const result=(await db.query('select monto,created_by from pagos')).rows;
   assert.equal(result.length,1);assert.equal(result[0].created_by,admin);await stock(5);
 });
 await check('invalid payment rolls back its receipt and audit',async()=>{
   await fail('select confirm_order_and_payments($1,$2,$3,$4)',[order,'entregado',JSON.stringify([{monto:-1}]),admin],/Monto inválido/);
   assert.equal((await db.query('select count(*)::int n from order_confirmation_receipts')).rows[0].n,1);
 });
 await db.exec('reset role;');
 await check('reapplying migrations does not alter historical stock or payments',async()=>{
   for(const file of ['20260919071608_diagnostic_critical_guards.sql','20260919071729_atomic_order_stock.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
   await stock(5);assert.equal((await db.query('select count(*)::int n from pagos')).rows[0].n,1);
 });
 await db.exec(`
 CREATE TABLE socio_invites(id uuid default gen_random_uuid(),socio_id uuid,email text,token text,consumed_at timestamptz,status text);
 ALTER TABLE socio_invites ENABLE ROW LEVEL SECURITY;
 CREATE POLICY "Admins can do everything on invites" ON socio_invites FOR ALL USING(true);
 CREATE POLICY "Public can read invites by token" ON socio_invites FOR SELECT USING(true);
 GRANT ALL ON socio_invites TO anon,authenticated,service_role;
 CREATE VIEW v_socio_latest_invite AS SELECT * FROM socio_invites;
 CREATE VIEW socios_with_auth AS SELECT * FROM socios;
 CREATE TABLE documentos_socio(id uuid,socio_id text);
 ALTER TABLE documentos_socio ENABLE ROW LEVEL SECURITY;
 CREATE VIEW v_documentacion_socios AS SELECT * FROM documentos_socio;
 ALTER TABLE socios ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_socio ON socios FOR SELECT USING(auth_user_id=auth.uid() OR public.get_my_role()='admin');
 INSERT INTO socio_invites(socio_id,email,token,status) VALUES('${member}','test@example.invalid','not-a-real-token','sent'),('${admin}','admin@example.invalid','another-test-token','sent');
 `);
 const privacy=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260919072224_protect_private_views.sql'),'utf8');
 await db.exec(privacy);
 await db.exec(`set request.jwt.claim.sub=''; set request.jwt.claim.role='anon'; set role anon;`);
 await check('anonymous cannot list invitations or invitation view',async()=>{
   await fail('select token from socio_invites',[],/permission denied/);
   await fail('select * from v_socio_latest_invite',[],/permission denied/);
 });
 await db.exec(`reset role; set request.jwt.claim.sub='${member}'; set request.jwt.claim.role='authenticated'; set role authenticated;`);
 await check('member sees only own invitation and cannot replace token',async()=>{
   assert.equal((await db.query('select token from socio_invites')).rows.length,1);
   await fail("update socio_invites set token='replacement'",[],/permission denied/);
   await db.query("update socio_invites set status='consumed',consumed_at=now() where socio_id=$1",[member]);
 });
 await check('profile view obeys member row security',async()=>{
   assert.equal((await db.query('select id from socios_with_auth')).rows.length,1);
 });
 await db.exec('reset role;');
 await db.exec(privacy);
 console.log(count+' database checks passed. Isolated PostgreSQL; no production data.');
 await db.close();
})().catch(async error=>{console.error(error);await db.close();process.exitCode=1;});
