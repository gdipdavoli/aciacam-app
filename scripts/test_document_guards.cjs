const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
module.exports=async function(db,check,admin,member) {
 await db.exec(`reset role;
 ALTER TABLE documentos_socio ALTER id SET DEFAULT gen_random_uuid();
 ALTER TABLE documentos_socio ADD tipo text,ADD archivo_path text,ADD estado text,ADD verificacion_estado text DEFAULT 'pendiente',
 ADD verificado_at timestamptz,ADD verificado_por text,ADD verificacion_obs text,ADD fecha_emision date,
 ADD fecha_vencimiento timestamptz,ADD user_id uuid,ADD observaciones text;
 GRANT SELECT,INSERT,UPDATE,DELETE ON documentos_socio TO authenticated;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260919074427_document_write_guards.sql'),'utf8'));
 await db.exec(`set request.jwt.claim.sub='${member}'; set role authenticated;`);
 await check('document ownership cannot be forged through uploader id',async()=>{
  await assert.rejects(db.query(`insert into documentos_socio(socio_id,user_id,tipo) values($1,$2,'dni')`,[admin,member]),/ajeno|row-level/);
 });
 let document;
 await check('member uploads pending document but cannot self-approve',async()=>{
  document=(await db.query(`insert into documentos_socio(socio_id,tipo,archivo_path) values($1,'dni','synthetic.pdf') returning id`,[member])).rows[0].id;
  await assert.rejects(db.query(`update documentos_socio set verificacion_estado='aprobado' where id=$1`,[document]),/aprobación/);
 });
 await db.exec(`reset role; set request.jwt.claim.sub='${admin}'; set role authenticated;`);
 await check('staff can verify and verified member edits require a new review',async()=>{
  await db.query(`update documentos_socio set verificacion_estado='aprobado' where id=$1`,[document]);
  await db.exec(`reset role; set request.jwt.claim.sub='${member}'; set role authenticated;`);
  await db.query(`update documentos_socio set fecha_vencimiento='2028-01-01' where id=$1`,[document]);
  assert.equal((await db.query(`select verificacion_estado from documentos_socio where id=$1`,[document])).rows[0].verificacion_estado,'pendiente');
 });
 await db.exec(`reset role; set request.jwt.claim.sub=''; delete from documentos_socio;`);
};
