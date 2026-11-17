-- Append to the reviewed 7B.4 transaction before COMMIT. Not an automatic migration.
ALTER TABLE public.action_grants ADD COLUMN approved_catalogue_hash text NOT NULL CHECK(approved_catalogue_hash ~ '^[0-9a-f]{64}$');
CREATE TABLE public.order_execution_attempts (
    attempt_id uuid PRIMARY KEY, grant_id uuid NOT NULL REFERENCES public.action_grants(grant_id),
    idempotency_key uuid NOT NULL, correlation_id uuid NOT NULL,
    status text NOT NULL CHECK(status IN ('PENDING','UNCERTAIN','FAILED','CONFIRMED')),
    error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX order_execution_attempts_grant_idx ON public.order_execution_attempts(grant_id,created_at DESC);
ALTER TABLE public.order_execution_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_execution_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_execution_attempts TO service_role;
CREATE FUNCTION public.record_order_attempt(p_grant_id uuid,p_key uuid,p_attempt_id uuid,p_state text,p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.action_grants; a public.order_execution_attempts;
BEGIN
    SELECT * INTO g FROM public.action_grants WHERE grant_id=p_grant_id AND idempotency_key=p_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_GRANT_SCOPE_INVALID'; END IF;
    IF p_state='PENDING' THEN
        INSERT INTO public.order_execution_attempts(attempt_id,grant_id,idempotency_key,correlation_id,status)
        VALUES(p_attempt_id,p_grant_id,p_key,g.correlation_id,'PENDING');
    ELSE
        SELECT * INTO a FROM public.order_execution_attempts WHERE attempt_id=p_attempt_id FOR UPDATE;
        IF NOT FOUND OR a.grant_id IS DISTINCT FROM p_grant_id OR a.idempotency_key IS DISTINCT FROM p_key
           OR a.status NOT IN ('PENDING','UNCERTAIN') THEN RAISE EXCEPTION 'ATTEMPT_TRANSITION_INVALID'; END IF;
        IF p_state='CONFIRMED' AND (g.status<>'executed' OR g.pedido_id IS NULL) THEN RAISE EXCEPTION 'ATTEMPT_UNCONFIRMED_RESULT'; END IF;
        IF p_state NOT IN ('UNCERTAIN','FAILED','CONFIRMED') THEN RAISE EXCEPTION 'ATTEMPT_STATE_INVALID'; END IF;
        UPDATE public.order_execution_attempts SET status=p_state,error_code=p_error,updated_at=clock_timestamp() WHERE attempt_id=p_attempt_id;
    END IF;
    RETURN jsonb_build_object('attempt_id',p_attempt_id,'status',p_state);
END $$;
REVOKE ALL ON FUNCTION public.record_order_attempt(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_attempt(uuid,uuid,uuid,text,text) TO service_role;
CREATE FUNCTION public.read_order_execution_state(p_grant_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.action_grants; a public.order_execution_attempts;
BEGIN
    SELECT * INTO g FROM public.action_grants WHERE grant_id=p_grant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
    IF g.revoked_at IS NOT NULL THEN RETURN 'REVOKED'; END IF;
    IF g.status='executed' THEN RETURN 'CONFIRMED'; END IF;
    SELECT * INTO a FROM public.order_execution_attempts WHERE grant_id=p_grant_id ORDER BY created_at DESC,attempt_id DESC LIMIT 1;
    IF NOT FOUND THEN RETURN CASE WHEN clock_timestamp()>=g.expires_at THEN 'EXPIRED' ELSE 'PENDING' END; END IF;
    IF a.status='PENDING' AND (clock_timestamp()>=g.expires_at OR clock_timestamp()>=a.created_at+interval '30 seconds') THEN RETURN 'UNCERTAIN'; END IF;
    RETURN a.status;
END $$;
REVOKE ALL ON FUNCTION public.read_order_execution_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_order_execution_status(p_grant_id uuid,p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    PERFORM public.assert_order_actor(p_actor,true);
    IF NOT EXISTS(SELECT 1 FROM public.action_grants WHERE grant_id=p_grant_id AND operator_auth_user_id=p_actor) THEN
        RAISE EXCEPTION 'GRANT_ACTOR_MISMATCH' USING ERRCODE='42501';
    END IF;
    RETURN public.read_order_execution_state(p_grant_id);
END $$;
REVOKE ALL ON FUNCTION public.read_order_execution_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_order_execution_status(uuid,uuid) TO service_role;
CREATE FUNCTION public.order_catalogue_hash(p_items jsonb) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
    SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',p.id,'tipo',p.tipo,'peso_gramos',p.peso_gramos,'activo',p.activo) ORDER BY p.id),'[]'::jsonb)::text,'UTF8')),'hex')
    FROM public.products p JOIN public.order_stock_quantities(p_items) q ON q.product_id=p.id;
$$;
REVOKE ALL ON FUNCTION public.order_catalogue_hash(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.protect_order_grant_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GRANT_HISTORY_IMMUTABLE'; END IF;
    IF ROW(NEW.grant_id,NEW.operator_auth_user_id,NEW.target_socio_id,NEW.action,NEW.approved_payload_hash,NEW.idempotency_key,NEW.issued_at,NEW.expires_at,NEW.correlation_id,NEW.approved_catalogue_hash)
      IS DISTINCT FROM ROW(OLD.grant_id,OLD.operator_auth_user_id,OLD.target_socio_id,OLD.action,OLD.approved_payload_hash,OLD.idempotency_key,OLD.issued_at,OLD.expires_at,OLD.correlation_id,OLD.approved_catalogue_hash) THEN
      RAISE EXCEPTION 'GRANT_SNAPSHOT_IMMUTABLE';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_order_grant_snapshot() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tr_order_grant_snapshot BEFORE UPDATE OR DELETE ON public.action_grants FOR EACH ROW EXECUTE FUNCTION public.protect_order_grant_snapshot();
CREATE FUNCTION public.validate_order_proposal(p_socio uuid,p_items jsonb,p_type text,p_address text,p_city text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE catalog jsonb;
BEGIN
    PERFORM public.assert_order_business(p_socio,p_items,p_type,p_address,p_city);
    SELECT jsonb_agg(jsonb_build_object('productoId',p.id,'cantidad',q.quantity,'tipo',p.tipo,'peso_gramos',p.peso_gramos,'stock',p.stock_disponible) ORDER BY p.id)
    INTO catalog FROM public.order_stock_quantities(p_items) q JOIN public.products p ON p.id=q.product_id;
    RETURN jsonb_build_object('valid',true,'catalogue',catalog,'notice','La validacion no reserva stock ni autoriza ejecucion.');
END $$;
REVOKE ALL ON FUNCTION public.validate_order_proposal(uuid,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_order_proposal(uuid,jsonb,text,text,text) TO service_role;
CREATE FUNCTION public.order_grant_hash(p_actor uuid,p_socio uuid,p_items jsonb,p_type text,p_motive text,p_details jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE items_text text;
BEGIN
    SELECT string_agg(product_id::text||':'||quantity::text,',' ORDER BY product_id)
    INTO items_text FROM public.order_stock_quantities(p_items);
    RETURN encode(sha256(convert_to(
        public.lpcp_frame('LPCP-v2')||public.lpcp_frame(p_actor::text)||public.lpcp_frame(p_socio::text)
        ||public.lpcp_frame(p_type)||public.lpcp_frame(items_text)||public.lpcp_frame(p_motive)
        ||public.lpcp_frame(CASE WHEN p_type='delivery' THEN p_details->>'direccion_entrega' ELSE '' END)
        ||public.lpcp_frame(CASE WHEN p_type='delivery' THEN p_details->>'localidad' ELSE '' END)
        ||public.lpcp_frame(CASE WHEN p_type='retiro_sede' THEN p_details->>'fecha_retiro' ELSE '' END)
        ||public.lpcp_frame(CASE WHEN p_type='retiro_sede' THEN p_details->>'franja_horaria' ELSE '' END)
        ||public.lpcp_frame(coalesce((p_details->>'slot_id')::uuid::text,''))
        ||public.lpcp_frame(p_details->>'observaciones'),'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION public.order_grant_hash(uuid,uuid,jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_order_grant(p_socio_id uuid,p_items jsonb,p_tipo_pedido text,p_motivo text,p_idempotency_key uuid,p_details jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); actor_socio uuid; g public.action_grants; h text; issued timestamptz:=clock_timestamp();
BEGIN
    actor_socio:=public.assert_order_actor(actor,true);
    IF p_idempotency_key IS NULL OR coalesce(btrim(p_motivo),'')='' THEN RAISE EXCEPTION 'GRANT_INPUT_INVALID'; END IF;
    PERFORM public.assert_order_business(p_socio_id,p_items,p_tipo_pedido,p_details->>'direccion_entrega',p_details->>'localidad');
    h:=public.order_grant_hash(actor,p_socio_id,p_items,p_tipo_pedido,p_motivo,p_details);
    PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
    SELECT * INTO g FROM public.action_grants WHERE idempotency_key=p_idempotency_key FOR UPDATE;
    IF FOUND THEN
        IF g.operator_auth_user_id IS DISTINCT FROM actor OR g.target_socio_id IS DISTINCT FROM p_socio_id
           OR g.approved_payload_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'GRANT_IDEMPOTENCY_CONFLICT'; END IF;
        RETURN to_jsonb(g);
    END IF;
    INSERT INTO public.action_grants(grant_id,operator_auth_user_id,target_socio_id,approved_payload_hash,idempotency_key,status,issued_at,expires_at,approved_catalogue_hash)
    VALUES(gen_random_uuid(),actor,p_socio_id,h,p_idempotency_key,'issued',issued,issued+interval '120 seconds',public.order_catalogue_hash(p_items)) RETURNING * INTO g;
    INSERT INTO public.audit_logs(user_id,actor_socio_id,action,entity_type,entity_id,details,created_at)
    VALUES(actor,actor_socio,'ORDER_GRANT_ISSUED','action_grants',g.grant_id::text,
      jsonb_build_object('payload_hash',h,'correlation_id',g.correlation_id,'idempotency_key',p_idempotency_key),clock_timestamp());
    RETURN to_jsonb(g);
END $$;
REVOKE ALL ON FUNCTION public.issue_order_grant(uuid,jsonb,text,text,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.issue_order_grant(uuid,jsonb,text,text,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.revoke_order_grant(p_grant_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); actor_socio uuid; g public.action_grants; actor_role text;
BEGIN
    actor_socio:=public.assert_order_actor(actor,true);
    IF coalesce(btrim(p_reason),'')='' THEN RAISE EXCEPTION 'REVOCATION_REASON_REQUIRED'; END IF;
    SELECT rol INTO actor_role FROM public.socios WHERE id=actor_socio;
    SELECT * INTO g FROM public.action_grants WHERE grant_id=p_grant_id FOR UPDATE;
    IF NOT FOUND OR (g.operator_auth_user_id IS DISTINCT FROM actor AND actor_role<>'admin') THEN RAISE EXCEPTION 'GRANT_NOT_ACCESSIBLE' USING ERRCODE='42501'; END IF;
    IF g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('revoked',true,'grant_id',g.grant_id); END IF;
    UPDATE public.action_grants SET status=CASE WHEN status='executed' THEN status ELSE 'revoked' END,
       revoked_at=clock_timestamp(),revoked_reason=p_reason,updated_at=clock_timestamp() WHERE grant_id=p_grant_id;
    INSERT INTO public.audit_logs(user_id,actor_socio_id,action,entity_type,entity_id,details,created_at)
    VALUES(actor,actor_socio,'ORDER_GRANT_REVOKED','action_grants',p_grant_id::text,
      jsonb_build_object('reason',p_reason,'correlation_id',g.correlation_id),clock_timestamp());
    RETURN jsonb_build_object('revoked',true,'grant_id',g.grant_id);
END $$;
REVOKE ALL ON FUNCTION public.revoke_order_grant(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.revoke_order_grant(uuid,text) TO authenticated;

-- Even legacy writes must respect an authenticated operator's suspension.
CREATE FUNCTION public.read_order_grant(p_grant_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); sid uuid; r text; g public.action_grants;
BEGIN
    sid:=public.assert_order_actor(actor,true);
    SELECT rol INTO r FROM public.socios WHERE id=sid;
    SELECT * INTO g FROM public.action_grants WHERE grant_id=p_grant_id;
    IF NOT FOUND OR (g.operator_auth_user_id IS DISTINCT FROM actor AND r<>'admin') THEN RAISE EXCEPTION 'GRANT_READ_DENIED' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('grant_id',g.grant_id,'status',g.status,'operation_state',public.read_order_execution_state(g.grant_id),'pedido_id',g.pedido_id,
       'approved_payload_hash',g.approved_payload_hash,'approved_catalogue_hash',g.approved_catalogue_hash,
       'correlation_id',g.correlation_id,'expires_at',g.expires_at,'revoked_at',g.revoked_at);
END $$;
REVOKE ALL ON FUNCTION public.read_order_grant(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_order_grant(uuid) TO authenticated;

CREATE FUNCTION public.enforce_order_operator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    PERFORM public.assert_order_actor(auth.uid(),false);
    IF TG_OP='INSERT' THEN
        IF NEW.estado IS DISTINCT FROM 'pendiente' OR NEW.created_by_user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'ORDER_CREATION_BOUNDARY_REQUIRED' USING ERRCODE='42501';
        END IF;
        IF NEW.origen='admin' AND NOT EXISTS (SELECT 1 FROM public.socios WHERE auth_user_id=auth.uid() AND rol IN ('admin','staff')) THEN
            RAISE EXCEPTION 'ORDER_ORIGIN_FORBIDDEN' USING ERRCODE='42501';
        END IF;
        PERFORM public.assert_order_business(NEW.socio_id,NEW.items,NEW.tipo_pedido,NEW.direccion_entrega,NEW.localidad);
    ELSIF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
        RAISE EXCEPTION 'ORDER_CREATOR_IMMUTABLE';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_order_operator() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tr_order_operator_guard BEFORE INSERT OR UPDATE ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_operator();
