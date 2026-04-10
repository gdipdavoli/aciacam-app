-- MIGRACION 31: SOPORTE PARA TICKETING Y HILOS
ALTER TABLE public.notificaciones 
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.notificaciones(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'abierto' CHECK (estado IN ('abierto', 'pendiente', 'cerrado')),
ADD COLUMN IF NOT EXISTS es_informativo BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS asignado_a UUID REFERENCES public.socios(id);

-- Índice para mejorar la velocidad al buscar hilos
CREATE INDEX IF NOT EXISTS idx_notif_parent ON public.notificaciones(parent_id);

-- Comentarios clarificadores
COMMENT ON COLUMN public.notificaciones.parent_id IS 'ID del mensaje raíz del hilo. Si es NULL, es el inicio de un caso.';
COMMENT ON COLUMN public.notificaciones.es_informativo IS 'Si es TRUE, es una notificación masiva/automática. Si es FALSE, es un caso de soporte individual.';
COMMENT ON COLUMN public.notificaciones.estado IS 'Estado del ticket: Abierto, Pendiente (esperando respuesta) o Cerrado.';
