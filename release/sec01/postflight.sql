DO $$ BEGIN
IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_pedidos_update_stock' AND tgfoid='app_private.tr_check_and_adjust_stock_on_update()'::regprocedure AND tgenabled='O') THEN RAISE EXCEPTION 'STOCK_TRIGGER_WRONG'; END IF;
IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.pedidos'::regclass AND tgname='tr_a_order_state_machine' AND tgenabled='O') THEN RAISE EXCEPTION 'M1_MISSING'; END IF;
IF has_table_privilege('authenticated','public.action_grants','INSERT') OR has_table_privilege('service_role','public.action_grants','INSERT') THEN RAISE EXCEPTION 'GRANT_WRITE_BYPASS'; END IF;
IF has_function_privilege('anon','public.transition_order_status_transaccional(uuid,text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'ANON_TRANSITION_BYPASS'; END IF;
IF has_table_privilege('service_role','public.order_transition_commands','UPDATE') THEN RAISE EXCEPTION 'COMMAND_MUTATION_PERMISSION'; END IF;
IF to_regclass('public.order_confirmation_receipts') IS NULL THEN RAISE EXCEPTION 'LEGACY_RECEIPTS_LOST'; END IF;
END $$;
