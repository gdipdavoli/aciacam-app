DO $$ BEGIN
IF to_regclass('public.order_confirmation_receipts') IS NULL THEN RAISE EXCEPTION 'BASELINE_RECEIPTS_MISSING'; END IF;
IF to_regprocedure('public.confirm_order_and_payments(uuid,text,jsonb,uuid)') IS NULL THEN RAISE EXCEPTION 'BASELINE_PAYMENTS_MISSING'; END IF;
IF to_regclass('public.action_grants') IS NOT NULL THEN RAISE EXCEPTION 'BASELINE_ALREADY_EXPANDED'; END IF;
IF EXISTS (SELECT auth_user_id FROM public.socios WHERE auth_user_id IS NOT NULL GROUP BY auth_user_id HAVING count(*) > 1) THEN RAISE EXCEPTION 'AMBIGUOUS_IDENTITY'; END IF;
END $$;
