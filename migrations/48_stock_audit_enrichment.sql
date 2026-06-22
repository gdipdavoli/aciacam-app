-- 1. Add audit columns to public.products table
alter table public.products add column if not exists last_audit_note text;
alter table public.products add column if not exists last_audit_order_id uuid;

-- 2. Re-create trigger function to capture the new audit fields
create or replace function public.log_product_changes()
returns trigger as $$
declare
    current_user_id uuid;
    socio_id uuid;
    payload jsonb;
    changes jsonb;
    old_data jsonb;
    new_data jsonb;
    action_type text;
    target_id text;
    v_note text;
    v_order_id uuid;
begin
    -- Determine User
    current_user_id := auth.uid();
    
    if current_user_id is not null then
        select id into socio_id from public.socios where user_id = current_user_id limit 1;
    end if;

    -- Determine Action and Data
    if (TG_OP = 'INSERT') then
        action_type := 'CREATE';
        target_id := NEW.id::text;
        new_data := to_jsonb(NEW);
        v_note := NEW.last_audit_note;
        v_order_id := NEW.last_audit_order_id;
        
        payload := jsonb_build_object(
            'before', null,
            'after', new_data,
            'changed', '[]'::jsonb,
            'note', v_note,
            'order_id', v_order_id
        );
    elsif (TG_OP = 'DELETE') then
        action_type := 'DELETE';
        target_id := OLD.id::text;
        old_data := to_jsonb(OLD);
        
        payload := jsonb_build_object(
            'before', old_data,
            'after', null,
            'changed', '[]'::jsonb,
            'note', 'Producto eliminado',
            'order_id', null
        );
    elsif (TG_OP = 'UPDATE') then
        action_type := 'UPDATE';
        target_id := NEW.id::text;
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        v_note := NEW.last_audit_note;
        v_order_id := NEW.last_audit_order_id;
        
        -- Calculate Changed Keys
        select jsonb_object_agg(key, value) into changes
        from jsonb_each(new_data)
        where old_data->key is distinct from new_data->key;

        if changes is null then
            changes := '{}'::jsonb;
        end if;

        payload := jsonb_build_object(
            'before', old_data,
            'after', new_data,
            'changes', changes,
            'note', v_note,
            'order_id', v_order_id
        );
    end if;

    -- Insert Log (only if we have an authenticated user context)
    if current_user_id is not null then
        insert into public.audit_logs (
            user_id,
            actor_socio_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        ) values (
            current_user_id,
            socio_id,
            action_type,
            'PRODUCT',
            target_id,
            payload,
            now()
        );
    end if;

    -- Return
    if (TG_OP = 'DELETE') then
        return OLD;
    else
        return NEW;
    end if;
end;
$$ language plpgsql security definer;

-- 3. Update confirm_order_delivery stored procedure to populate audit metadata
create or replace function public.confirm_order_delivery(p_order_id uuid)
returns json
language plpgsql
security definer
as $$
declare
    v_order record;
    v_item jsonb;
    v_product_id uuid;
    v_quantity int;
begin
    -- 1. Fetch Order and lock row
    select * from public.pedidos 
    into v_order 
    where id = p_order_id 
    for update;

    if not found then
        return json_build_object('success', false, 'error', 'Pedido no encontrado');
    end if;

    -- 2. Validate Status
    if v_order.estado in ('entregado', 'retirado', 'cancelado') then
        return json_build_object('success', false, 'error', 'El pedido ya fue finalizado previamente');
    end if;

    -- 3. Loop through items and deduct stock
    if v_order.items is not null and jsonb_array_length(v_order.items) > 0 then
        for v_item in select * from jsonb_array_elements(v_order.items)
        loop
            v_product_id := (v_item->>'productoId')::uuid;
            v_quantity := (v_item->>'cantidad')::int;

            -- Update product stock and store audit parameters
            update public.products
            set stock_disponible = stock_disponible - v_quantity,
                last_audit_note = 'Descuento automático por entrega de pedido',
                last_audit_order_id = p_order_id
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
