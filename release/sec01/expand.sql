BEGIN;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_socio_id uuid REFERENCES public.socios(id);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS last_audit_note text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS last_audit_order_id uuid;
COMMIT;
