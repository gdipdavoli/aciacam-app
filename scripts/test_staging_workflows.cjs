// Called by test_diagnostic_db.cjs with RUN_STAGING_TESTS=1. Synthetic data only.
const fs=require('node:fs'); const path=require('node:path'); const assert=require('node:assert/strict');
module.exports=async function(db,check,admin,member) {
 await db.exec(`reset role; set request.jwt.claim.sub='${admin}';
 ALTER TABLE socios ADD nombre text DEFAULT 'Persona ficticia',ADD apellido text DEFAULT 'Prueba',ADD dni text,
 ADD email text,ADD diagnostico text,ADD reprocann_num_tramite text,ADD reprocann_estado text,ADD reprocann_fecha_alta date;
 CREATE POLICY staff_change ON socios FOR UPDATE USING(public.get_my_role()='admin') WITH CHECK(public.get_my_role()='admin');
 ALTER TABLE pedidos ADD created_at timestamptz DEFAULT now();
 CREATE TABLE cierres_mensuales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),socio_id uuid,periodo text,
 numero_constancia text DEFAULT gen_random_uuid()::text,fecha_generacion timestamptz, generado_por uuid,
 datos jsonb,hash_sha256 text,estado text,fecha_anulacion timestamptz,motivo_anulacion text,anulado_por uuid,UNIQUE(socio_id,periodo));
 CREATE SEQUENCE cierres_correlativo_seq;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260919073601_diagnostic_staging_workflows.sql'),'utf8'));
 await db.exec(`set role authenticated;`);
 let close;
 await check('closure ignores forged snapshot, hash and actor',async()=>{
  close=(await db.query(`insert into cierres_mensuales(socio_id,periodo,datos,hash_sha256,generado_por) values($1,'2026-09','{"forged":true}','forged',$1) returning *`,[member])).rows[0];
  assert.equal(close.generado_por,admin);assert.equal(close.datos.socio.nombre,'Persona ficticia');assert.equal(close.datos.forged,undefined);
  assert.equal(close.hash_sha256.length,64);
  assert.equal((await db.query(`select count(*)::int n from audit_logs where entity_id=$1`,[close.id])).rows[0].n,1);
 });
 await check('closure content cannot be edited, only annulled with a reason',async()=>{
  await assert.rejects(db.query(`update cierres_mensuales set datos='{}' where id=$1`,[close.id]),/Solo se permite/);
  await assert.rejects(db.query(`update cierres_mensuales set estado='anulado',motivo_anulacion=' ' where id=$1`,[close.id]),/Solo se permite/);
  await db.query(`update cierres_mensuales set estado='anulado',motivo_anulacion='Prueba' where id=$1`,[close.id]);
  assert.equal((await db.query('select anulado_por from cierres_mensuales where id=$1',[close.id])).rows[0].anulado_por,admin);
 });
 await check('failed audit rolls back closure creation',async()=>{
  await db.exec('reset role; REVOKE INSERT ON audit_logs FROM authenticated; set role authenticated;');
  await assert.rejects(db.query(`insert into cierres_mensuales(socio_id,periodo) values($1,'2026-08')`,[member]),/permission denied/);
  assert.equal((await db.query(`select id from cierres_mensuales where periodo='2026-08'`)).rows.length,0);
  await db.exec('reset role; GRANT INSERT ON audit_logs TO authenticated; set role authenticated;');
 });
 await check('month boundary uses Buenos Aires midnight and excludes next month',async()=>{
  for(const date of ['2026-08-01T02:59:59Z','2026-08-01T03:00:00Z','2026-09-01T03:00:00Z'])
   await db.query(`insert into pagos(socio_id,fecha,monto) values($1,$2,17)`,[member,date]);
  const c=(await db.query(`insert into cierres_mensuales(socio_id,periodo) values($1,'2026-08') returning datos`,[member])).rows[0];
  assert.equal(c.datos.aportes.length,1);
 });
 let document;
 await check('approving REPROCANN requires complete dates and synchronizes member atomically',async()=>{
  await assert.rejects(db.query(`insert into documentos_socio(socio_id,tipo,archivo_path,verificacion_estado) values($1,'reprocann','test.pdf','aprobado')`,[member]),/Confirmá archivo/);
  document=(await db.query(`insert into documentos_socio(socio_id,tipo,archivo_path,verificacion_estado,fecha_emision,fecha_vencimiento) values($1,'reprocann','test.pdf','aprobado','2026-01-01','2027-01-01T00:00:00Z') returning id`,[member])).rows[0].id;
  assert.equal((await db.query(`select reprocann_fecha_vencimiento::text d from socios where id=$1`,[member])).rows[0].d,'2027-01-01');
 });
 await db.exec(`reset role; set request.jwt.claim.sub='${member}'; set role authenticated;`);
 await check('member cannot approve documents or attach a document to someone else',async()=>{
  await assert.rejects(db.query(`insert into documentos_socio(socio_id,tipo,verificacion_estado) values($1,'dni','aprobado')`,[member]),/aprobación/);
  await assert.rejects(db.query(`insert into documentos_socio(socio_id,tipo) values($1,'dni')`,[admin]),/ajeno/);
 });
 await check('replacing certificate preserves old version and requires review again',async()=>{
  await db.query(`update documentos_socio set archivo_path='new.pdf',verificacion_estado='pendiente' where id=$1`,[document]);
  const old=(await db.query(`select datos from documentos_socio_versiones where documento_id=$1`,[document])).rows;
  assert.equal(old.length,1);assert.equal(old[0].datos.archivo_path,'test.pdf');
  assert.equal((await db.query(`select verificacion_estado from documentos_socio where id=$1`,[document])).rows[0].verificacion_estado,'pendiente');
  await assert.rejects(db.query(`insert into documentos_socio_versiones(documento_id,socio_id,datos) values($1,$2,'{}')`,[document,member]),/permission denied/);
 });
 await check('member cannot generate a closure',async()=>{
  await assert.rejects(db.query(`insert into cierres_mensuales(socio_id,periodo) values($1,'2026-07')`,[member]),/No autorizado|row-level/);
 });
};
