-- MIGRACION 41: COLUMNA PARA OCULTAR HILOS A SOCIOS
ALTER TABLE public.notificaciones 
ADD COLUMN IF NOT EXISTS oculto_para_socio BOOLEAN DEFAULT false;

-- Comentario aclaratorio
COMMENT ON COLUMN public.notificaciones.oculto_para_socio IS 'Si es TRUE, el hilo/mensaje no se muestra al socio, pero sigue visible para el administrador.';
