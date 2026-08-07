-- Migration 49: Strict Stock Reservation and Auto-Release Triggers
-- This migration ensures stock is reserved immediately when a pedido is created,
-- and returned if the pedido is cancelled or items are modified.

-- 1. Create trigger function to check and deduct stock on insert
CREATE OR REPLACE FUNCTION public.tr_check_and_deduct_stock_on_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_item JSONB;
    v_product_id UUID;
    v_qty INT;
    v_stock INT;
    v_prod_name TEXT;
BEGIN
    -- Only run stock validation and deduction if the order is active upon creation
    IF NEW.estado NOT IN ('cancelado', 'entregado', 'retirado') THEN
        IF NEW.items IS NOT NULL AND jsonb_array_length(NEW.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                -- Fetch current stock and product name
                SELECT stock_disponible, nombre INTO v_stock, v_prod_name 
                FROM public.products WHERE id = v_product_id;
                
                IF v_stock IS NULL THEN
                    RAISE EXCEPTION 'El producto solicitado con ID % no existe.', v_product_id;
                END IF;
                
                IF v_stock < v_qty THEN
                    RAISE EXCEPTION 'Stock insuficiente para el producto "%". Solicitado: %, Disponible: %', v_prod_name, v_qty, v_stock;
                END IF;
                
                -- Deduct stock
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_qty
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind INSERT trigger
DROP TRIGGER IF EXISTS tr_pedidos_insert_stock ON public.pedidos;
CREATE TRIGGER tr_pedidos_insert_stock
BEFORE INSERT ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.tr_check_and_deduct_stock_on_insert();


-- 2. Create trigger function to handle stock on update (cancel, reactivate, or item edits)
CREATE OR REPLACE FUNCTION public.tr_check_and_adjust_stock_on_update()
RETURNS TRIGGER AS $$
DECLARE
    v_item JSONB;
    v_product_id UUID;
    v_qty INT;
    v_stock INT;
    v_prod_name TEXT;
BEGIN
    -- Case 1: Order is cancelled
    IF NEW.estado = 'cancelado' AND OLD.estado IS DISTINCT FROM 'cancelado' THEN
        -- If old state was active (not delivered/retrieved), return the stock
        IF OLD.estado NOT IN ('entregado', 'retirado') THEN
            IF OLD.items IS NOT NULL AND jsonb_array_length(OLD.items) > 0 THEN
                FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items) LOOP
                    v_product_id := (v_item->>'productoId')::uuid;
                    v_qty := (v_item->>'cantidad')::int;
                    
                    UPDATE public.products 
                    SET stock_disponible = stock_disponible + v_qty
                    WHERE id = v_product_id;
                END LOOP;
            END IF;
        END IF;
    
    -- Case 2: Order is reactivated from cancelled
    ELSIF OLD.estado = 'cancelado' AND NEW.estado IS DISTINCT FROM 'cancelado' AND NEW.estado NOT IN ('entregado', 'retirado') THEN
        -- Deduct stock for the new items
        IF NEW.items IS NOT NULL AND jsonb_array_length(NEW.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                SELECT stock_disponible, nombre INTO v_stock, v_prod_name 
                FROM public.products WHERE id = v_product_id;
                
                IF v_stock IS NULL THEN
                    RAISE EXCEPTION 'El producto solicitado con ID % no existe.', v_product_id;
                END IF;
                
                IF v_stock < v_qty THEN
                    RAISE EXCEPTION 'Stock insuficiente para el producto "%". Solicitado: %, Disponible: %', v_prod_name, v_qty, v_stock;
                END IF;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_qty
                WHERE id = v_product_id;
            END LOOP;
        END IF;

    -- Case 3: Items are edited in an active order
    ELSIF OLD.items IS DISTINCT FROM NEW.items AND NEW.estado NOT IN ('cancelado', 'entregado', 'retirado') THEN
        -- Refund old items first
        IF OLD.items IS NOT NULL AND jsonb_array_length(OLD.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible + v_qty
                WHERE id = v_product_id;
            END LOOP;
        END IF;

        -- Charge new items
        IF NEW.items IS NOT NULL AND jsonb_array_length(NEW.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                SELECT stock_disponible, nombre INTO v_stock, v_prod_name 
                FROM public.products WHERE id = v_product_id;
                
                IF v_stock IS NULL THEN
                    RAISE EXCEPTION 'El producto solicitado con ID % no existe.', v_product_id;
                END IF;
                
                IF v_stock < v_qty THEN
                    RAISE EXCEPTION 'Stock insuficiente para el producto "%". Solicitado: %, Disponible: %', v_prod_name, v_qty, v_stock;
                END IF;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_qty
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind UPDATE trigger
DROP TRIGGER IF EXISTS tr_pedidos_update_stock ON public.pedidos;
CREATE TRIGGER tr_pedidos_update_stock
BEFORE UPDATE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.tr_check_and_adjust_stock_on_update();


-- 3. Modify confirm_order_delivery function to NOT double-deduct stock
CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
BEGIN
    -- 1. Fetch Order and lock row
    SELECT * FROM public.pedidos 
    INTO v_order 
    WHERE id = p_order_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Pedido no encontrado');
    END IF;

    -- 2. Validate Status
    IF v_order.estado IN ('entregado', 'retirado', 'cancelado') THEN
        RETURN json_build_object('success', false, 'error', 'El pedido ya fue finalizado previamente');
    END IF;

    -- 3. Update Order Status to delivered (stock has already been deducted on creation)
    UPDATE public.pedidos
    SET estado = 'entregado'
    WHERE id = p_order_id;

    RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- 4. Backfill: Deduct stock for all existing active (non-finalized) orders
-- This aligns existing orders with the new triggers since they hadn't deducted stock yet.
DO $$
DECLARE
    r_order RECORD;
    r_item JSONB;
    v_product_id UUID;
    v_quantity INT;
BEGIN
    FOR r_order IN 
        SELECT * FROM public.pedidos 
        WHERE estado NOT IN ('entregado', 'retirado', 'cancelado')
    LOOP
        IF r_order.items IS NOT NULL AND jsonb_array_length(r_order.items) > 0 THEN
            FOR r_item IN SELECT * FROM jsonb_array_elements(r_order.items) LOOP
                v_product_id := (r_item->>'productoId')::uuid;
                v_quantity := (r_item->>'cantidad')::int;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_quantity
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    END LOOP;
END;
$$;
