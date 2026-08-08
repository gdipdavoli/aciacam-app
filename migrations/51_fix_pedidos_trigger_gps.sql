-- Migration 51: Fix Pedidos trigger column names (gps -> ubicacion_gps)
-- Recreate the check_pedidos_update_only_status function with correct column names

CREATE OR REPLACE FUNCTION public.check_pedidos_update_only_status()
RETURNS TRIGGER AS $$
BEGIN
  -- If user is admin or staff, bypass all restrictions and allow any update
  IF public.get_my_role() IN ('admin', 'staff') THEN
    RETURN NEW;
  END IF;

  -- Verify ownership: the socio_id on the order must belong to the authenticated user
  IF NOT EXISTS (
    SELECT 1 FROM public.socios
    WHERE id = OLD.socio_id
    AND (auth_user_id = auth.uid() OR user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'No autorizado para modificar este pedido.';
  END IF;

  -- Ensure only 'estado' and 'updated_at' are being modified
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.socio_id IS DISTINCT FROM OLD.socio_id OR
     NEW.tipo_pedido IS DISTINCT FROM OLD.tipo_pedido OR
     NEW.origen IS DISTINCT FROM OLD.origen OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.items IS DISTINCT FROM OLD.items OR
     NEW.observaciones IS DISTINCT FROM OLD.observaciones OR
     NEW.direccion_entrega IS DISTINCT FROM OLD.direccion_entrega OR
     NEW.localidad IS DISTINCT FROM OLD.localidad OR
     NEW.fecha_retiro_preferida IS DISTINCT FROM OLD.fecha_retiro_preferida OR
     NEW.franja_horaria IS DISTINCT FROM OLD.franja_horaria OR
     NEW.ubicacion_gps IS DISTINCT FROM OLD.ubicacion_gps OR
     NEW.entrega_estimada IS DISTINCT FROM OLD.entrega_estimada OR
     NEW.archivado IS DISTINCT FROM OLD.archivado OR
     NEW.total IS DISTINCT FROM OLD.total OR
     NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago OR
     NEW.comprobante_pago IS DISTINCT FROM OLD.comprobante_pago OR
     NEW.slot_id IS DISTINCT FROM OLD.slot_id OR
     NEW.requires_rescheduling IS DISTINCT FROM OLD.requires_rescheduling
  THEN
    RAISE EXCEPTION 'Los socios sólo pueden modificar el estado de sus pedidos.';
  END IF;

  -- Enforce state transition checks:
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    -- A socio can only cancel orders in 'pendiente' or 'procesando' (and we'll include en_preparacion just in case)
    IF OLD.estado NOT IN ('pendiente', 'procesando', 'en_preparacion') THEN
      RAISE EXCEPTION 'No se puede cancelar un pedido en estado %', OLD.estado;
    END IF;
    -- A socio can only change the state to 'cancelado'
    IF NEW.estado <> 'cancelado' THEN
      RAISE EXCEPTION 'Los socios sólo pueden cancelar sus pedidos.';
    END IF;
  END IF;

  -- Auto-update updated_at timestamp
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
