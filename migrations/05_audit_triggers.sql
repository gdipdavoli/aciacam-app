-- AUDIT TRIGGERS FOR PRODUCTS
-- Mandatory audit logging via DB Triggers

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
begin
    -- 1. Determine User
    current_user_id := auth.uid();
    
    -- If no auth user (e.g. direct SQL), we might default or error. 
    -- User requested strict auth.uid(). If null, it will fail NOT NULL constraint on audit_logs, which is good (mandatory auth).
    -- However, for initial seeds or edge cases, we might want to handle it. 
    -- Proceeding with assumption that mutations happen within Auth context.

    -- 2. Resolve optional Socio ID for convenience
    if current_user_id is not null then
        select id into socio_id from public.socios where user_id = current_user_id limit 1;
    end if;

    -- 3. Determine Action and Data
    if (TG_OP = 'INSERT') then
        action_type := 'CREATE';
        target_id := NEW.id::text;
        new_data := to_jsonb(NEW);
        payload := jsonb_build_object(
            'before', null,
            'after', new_data,
            'changed', '[]'::jsonb
        );
    elsif (TG_OP = 'DELETE') then
        action_type := 'DELETE';
        target_id := OLD.id::text;
        old_data := to_jsonb(OLD);
        payload := jsonb_build_object(
            'before', old_data,
            'after', null,
            'changed', '[]'::jsonb
        );
    elsif (TG_OP = 'UPDATE') then
        action_type := 'UPDATE';
        target_id := NEW.id::text;
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        
        -- Calculate Changed Keys
        select jsonb_agg(key) into changes
        from jsonb_each(new_data)
        where old_data->key is distinct from new_data->key;

        if changes is null then
            changes := '[]'::jsonb;
        end if;

        payload := jsonb_build_object(
            'before', old_data,
            'after', new_data,
            'changed', changes
        );
    end if;

    -- 4. Insert Log
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

    -- Return
    if (TG_OP = 'DELETE') then
        return OLD;
    else
        return NEW;
    end if;
end;
$$ language plpgsql security definer;

-- DROP OLD TRIGGERS IF EXIST
drop trigger if exists tr_audit_products_insert on public.products;
drop trigger if exists tr_audit_products_update on public.products;
drop trigger if exists tr_audit_products_delete on public.products;
drop trigger if exists tr_audit_product_update on public.products; -- old name

-- CREATE NEW TRIGGERS
create trigger tr_audit_products_insert
after insert on public.products
for each row execute function public.log_product_changes();

create trigger tr_audit_products_update
after update on public.products
for each row execute function public.log_product_changes();

create trigger tr_audit_products_delete
after delete on public.products
for each row execute function public.log_product_changes();
