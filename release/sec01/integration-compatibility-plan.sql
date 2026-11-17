-- ============================================================================
-- ACIACAM — H5B: Plan SQL de Compatibilidad para Supabase Integration (uqwuhjxzazsexuvqxmfm)
-- ADVERTENCIA: NO EJECUTAR EN PRODUCCIÓN NI SIN AUTORIZACIÓN EXPLÍCITA.
-- Este archivo documenta de forma autocontenida:
--   1. Preflight read-only
--   2. Plan de aplicación mínimo e idempotente (compatibility.sql adaptado a Integration)
--   3. Postflight de verificación para Integration
--   4. Rollback selectivo seguro
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PREFLIGHT READ-ONLY (ejecutar dentro de BEGIN READ ONLY ... ROLLBACK)
-- ----------------------------------------------------------------------------
-- Verifica estado actual antes de aplicar compatibility.sql en Integration:
--   - M1 y M2 activas
--   - check_pedidos_update_only_status() ausente en Integration (es legacy de Producción)
--   - order_confirmation_receipts ausente en Integration (tabla legacy de Producción)
--   - order_transition_commands aún tiene UPDATE otorgado a service_role
/*
BEGIN READ ONLY;
SELECT
  EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_a_order_state_machine' AND tgenabled='O') AS m1_active,
  EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_pedidos_update_stock' AND tgenabled='O') AS stock_trigger_active,
  EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_0_legacy_order_actor' AND tgenabled='O') AS legacy_actor_trigger_present,
  to_regprocedure('public.check_pedidos_update_only_status()')::text AS legacy_update_guard_proc,
  to_regclass('public.order_confirmation_receipts')::text AS legacy_receipts_table,
  has_table_privilege('service_role', 'public.order_transition_commands', 'UPDATE') AS svc_cmd_update_present,
  has_table_privilege('service_role', 'public.order_transition_commands', 'DELETE') AS svc_cmd_delete_present;
ROLLBACK;
*/

-- ----------------------------------------------------------------------------
-- 2. PLAN DE APLICACIÓN MÍNIMO E IDEMPOTENTE PARA INTEGRATION
-- ----------------------------------------------------------------------------
/*
BEGIN;

CREATE OR REPLACE FUNCTION app_private.fill_legacy_order_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.created_by_user_id IS NULL THEN
    NEW.created_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app_private.fill_legacy_order_actor() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_0_legacy_order_actor ON public.pedidos;
CREATE TRIGGER tr_0_legacy_order_actor
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION app_private.fill_legacy_order_actor();

REVOKE ALL ON public.order_transition_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.order_transition_commands TO service_role;

COMMIT;
*/

-- ----------------------------------------------------------------------------
-- 3. POSTFLIGHT DE VERIFICACIÓN PARA INTEGRATION
-- ----------------------------------------------------------------------------
/*
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_pedidos_update_stock' AND tgfoid='app_private.tr_check_and_adjust_stock_on_update()'::regprocedure AND tgenabled='O') THEN
    RAISE EXCEPTION 'STOCK_TRIGGER_WRONG';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_a_order_state_machine' AND tgenabled='O') THEN
    RAISE EXCEPTION 'M1_MISSING';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_0_legacy_order_actor' AND tgenabled='O') THEN
    RAISE EXCEPTION 'LEGACY_ACTOR_TRIGGER_MISSING';
  END IF;
  IF has_table_privilege('authenticated', 'public.action_grants', 'INSERT') OR has_table_privilege('service_role', 'public.action_grants', 'INSERT') THEN
    RAISE EXCEPTION 'GRANT_WRITE_BYPASS';
  END IF;
  IF has_function_privilege('anon', 'public.transition_order_status_transaccional(uuid,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ANON_TRANSITION_BYPASS';
  END IF;
  IF has_table_privilege('service_role', 'public.order_transition_commands', 'UPDATE') OR has_table_privilege('service_role', 'public.order_transition_commands', 'DELETE') THEN
    RAISE EXCEPTION 'COMMAND_MUTATION_PERMISSION';
  END IF;
END $$;
*/

-- ----------------------------------------------------------------------------
-- 4. ROLLBACK SELECTIVO SEGURO (preserva datos, órdenes y comandos existentes)
-- ----------------------------------------------------------------------------
/*
BEGIN;
DROP TRIGGER IF EXISTS tr_0_legacy_order_actor ON public.pedidos;
DROP FUNCTION IF EXISTS app_private.fill_legacy_order_actor();
-- No se eliminan filas de order_transition_commands ni pedidos.
-- Si alguna operación de mantenimiento requiriera restaurar privilegios previos en Integration:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_transition_commands TO service_role;
COMMIT;
*/
