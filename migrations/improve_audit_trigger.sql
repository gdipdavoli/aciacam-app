-- Function to calculate diff and log changes
create or replace function public.log_product_changes()
returns trigger as $$
declare
    socio_id uuid;
    changes jsonb;
    old_data jsonb;
    new_data jsonb;
begin
    -- 1. Resolve Actor (Socio ID) from Auth User ID
    select id into socio_id from public.socios where user_id = auth.uid();

    -- If no linked socio found (e.g. service role or unlinked user), socio_id will be null.
    -- Ideally we want to log it anyway, maybe with null actor or system.
    
    -- 2. Prepare JSONs
    old_data = to_jsonb(OLD);
    new_data = to_jsonb(NEW);
    
    -- 3. Calculate Changes (Diff)
    -- We select keys from NEW where the value in NEW is distinct from OLD
    select jsonb_object_agg(key, value) into changes
    from jsonb_each(new_data)
    where old_data->key is distinct from new_data->key;

    -- Only log if there are actual changes
    if changes is not null then
        insert into public.audit_logs (
            actor_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        ) values (
            socio_id,
            'UPDATE',
            'PRODUCT',
            NEW.id::text,
            jsonb_build_object(
                'old', old_data,
                'new', new_data,
                'changes', changes
            ),
            now()
        );
    end if;

    return NEW;
end;
$$ language plpgsql security definer;

-- Create Trigger
drop trigger if exists tr_audit_product_update on public.products;
create trigger tr_audit_product_update
after update on public.products
for each row
execute function public.log_product_changes();
