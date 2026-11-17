-- Recovery proposal, NOT a migration. Preserve every grant, order and audit row.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.issue_order_grant(uuid,jsonb,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.ejecutar_pedido_con_autorizacion_delegada(uuid,uuid,uuid,jsonb,text,text,text,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
-- Do not drop grants (including issued/revoked), reset stock, replay, or erase attempts.
-- Keep SELECT for controlled administrative forensic inspection.
COMMIT;
