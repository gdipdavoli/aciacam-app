-- Migration 24: Add GPS location to pedidos table
alter table public.pedidos 
add column if not exists ubicacion_gps text;

-- Add comment for documentation
comment on column public.pedidos.ubicacion_gps is 'Enlace de Google Maps o coordenadas GPS capturadas al realizar el pedido.';
