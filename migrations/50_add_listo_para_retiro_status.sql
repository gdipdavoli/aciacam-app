-- Migration 50: Add 'listo_para_retiro' status to public.pedidos constraint
-- This status is used when staff completes the picking of a pedido.

-- 1. Drop old constraint if exists
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS check_pedidos_estado;

-- 2. Add updated constraint
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_estado_check CHECK (estado IN ('pendiente', 'confirmado', 'en_preparacion', 'listo_para_retiro', 'en_camino', 'retirado', 'entregado', 'cancelado'));
