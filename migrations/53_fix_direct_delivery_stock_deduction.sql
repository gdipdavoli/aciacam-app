-- Migration 53: Fix Direct Delivery Stock Deduction
-- This migration updates trigger functions on 'pedidos' to ensure stock is deducted for all active orders upon insert
-- (including 'entregado' and 'retirado' direct sales), and correctly handled during updates.

-- 1. Recreate trigger function for INSERT
CREATE OR REPLACE FUNCTION public.tr_check_and_deduct_stock_on_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_item JSONB;
    v_product_id UUID;
    v_qty INT;
    v_stock INT;
    v_prod_name TEXT;
BEGIN
    -- Only skip stock deduction if order is cancelled upon creation
    IF NEW.estado IS DISTINCT FROM 'cancelado' THEN
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
                
                -- Deduct stock and set audit details
                UPDATE public.products 
                SET stock_disponible = stock_disponible - v_qty,
                    last_audit_note = 'Descuento por nuevo pedido (' || NEW.estado || ')',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 2. Recreate trigger function for UPDATE
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
        -- Return stock if it was active
        IF OLD.items IS NOT NULL AND jsonb_array_length(OLD.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible + v_qty,
                    last_audit_note = 'Devolución de stock por pedido cancelado',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    
    -- Case 2: Order is reactivated from cancelled
    ELSIF OLD.estado = 'cancelado' AND NEW.estado IS DISTINCT FROM 'cancelado' THEN
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
                SET stock_disponible = stock_disponible - v_qty,
                    last_audit_note = 'Descuento de stock por reactivación de pedido (' || NEW.estado || ')',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;

    -- Case 3: Items are edited in an active order
    ELSIF OLD.items IS DISTINCT FROM NEW.items AND NEW.estado IS DISTINCT FROM 'cancelado' THEN
        -- Refund old items first
        IF OLD.items IS NOT NULL AND jsonb_array_length(OLD.items) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(OLD.items) LOOP
                v_product_id := (v_item->>'productoId')::uuid;
                v_qty := (v_item->>'cantidad')::int;
                
                UPDATE public.products 
                SET stock_disponible = stock_disponible + v_qty,
                    last_audit_note = 'Ajuste de stock por modificación de items (reintegro)',
                    last_audit_order_id = NEW.id
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
                SET stock_disponible = stock_disponible - v_qty,
                    last_audit_note = 'Ajuste de stock por modificación de items (cargo)',
                    last_audit_order_id = NEW.id
                WHERE id = v_product_id;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
