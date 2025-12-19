-- RPC function to atomically confirm delivery and deduct stock
-- Prevents double updates and ensures transactional integrity.

create or replace function public.confirm_order_delivery(p_order_id uuid)
returns json
language plpgsql
security definer -- Runs with elevated privileges to update tables
as $$
declare
    v_order record;
    v_item jsonb;
    v_product_id uuid;
    v_quantity int;
    v_current_stock int;
begin
    -- 1. Fetch Order and lock row
    select * from public.pedidos 
    into v_order 
    where id = p_order_id 
    for update;

    if not found then
        return json_build_object('success', false, 'error', 'Pedido no encontrado');
    end if;

    -- 2. Validate Status (Prevent double deduction)
    if v_order.estado in ('entregado', 'retirado', 'cancelado') then
        return json_build_object('success', false, 'error', 'El pedido ya fue finalizado previamente');
    end if;

    -- 3. Loop through items and deduct stock
    -- Items is a JSONB array of objects { "productoId": "...", "cantidad": N, ... }
    
    if v_order.items is not null and jsonb_array_length(v_order.items) > 0 then
        for v_item in select * from jsonb_array_elements(v_order.items)
        loop
            v_product_id := (v_item->>'productoId')::uuid;
            v_quantity := (v_item->>'cantidad')::int;

            -- Update product stock
            -- We confirm the product exists and has stock (allowing negative stock is a business decision, here strictly we could check)
            -- Simplification: Just subtract. If you want to prevent negative, add check.
            update public.products
            set stock_disponible = stock_disponible - v_quantity
            where id = v_product_id;
            
        end loop;
    end if;

    -- 4. Update Order Status
    update public.pedidos
    set estado = 'entregado'
    where id = p_order_id;

    return json_build_object('success', true);

exception when others then
    return json_build_object('success', false, 'error', SQLERRM);
end;
$$;
