-- MIGRACION 42: CORREGIR PERMISOS DE ACTUALIZACION DE NOTIFICACIONES
-- Dropear la política restrictiva anterior
DROP POLICY IF EXISTS "Socios can mark their notifications as read" ON public.notificaciones;

-- Crear una política más amplia que permita al socio actualizar CUALQUIER mensaje de sus propios hilos
-- (Necesario para ocultar hilos completos y marcar como leídos hilos donde el socio inició la conversación)
CREATE POLICY "Socios can update their own notification threads"
ON public.notificaciones FOR UPDATE
USING (
    auth.uid() IN (
        SELECT auth_user_id FROM public.socios 
        WHERE id = socio_id
    )
)
WITH CHECK (
    auth.uid() IN (
        SELECT auth_user_id FROM public.socios 
        WHERE id = socio_id
    )
);

COMMENT ON POLICY "Socios can update their own notification threads" ON public.notificaciones 
IS 'Permite a los socios actualizar (leer/ocultar) mensajes de hilos que les pertenecen.';
