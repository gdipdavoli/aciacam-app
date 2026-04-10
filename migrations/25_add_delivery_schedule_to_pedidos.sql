-- Migration 25: Add delivery schedule field to pedidos and enable delivery for all socios

-- 1. Add entrega_estimada to pedidos
alter table public.pedidos 
add column if not exists entrega_estimada text;

comment on column public.pedidos.entrega_estimada is 'Día y horario estimado de visita para la entrega del pedido.';

-- 2. Enable delivery for all registered socios
update public.socios 
set envios_habilitados = true 
where id in (select id from public.socios);
