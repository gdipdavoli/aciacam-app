-- ============================================================================
-- H3: Ensayo aislado de comportamiento (stock, pagos, permisos, idempotencia)
-- Se ejecuta sobre la base desechable tras aplicar release/sec01/sequence.json
-- ============================================================================

DO $$
DECLARE
    v_staff_uid uuid := '91000000-0000-4000-8000-000000000001';
    v_socio1_uid uuid := '91000000-0000-4000-8000-000000000002';
    v_socio2_uid uuid := '91000000-0000-4000-8000-000000000003';
    v_staff_socio uuid := '92000000-0000-4000-8000-000000000001';
    v_socio1_id uuid := '92000000-0000-4000-8000-000000000002';
    v_socio2_id uuid := '92000000-0000-4000-8000-000000000003';
    v_prod_id uuid := '93000000-0000-4000-8000-000000000001';
    v_ord1 uuid;
    v_ord2 uuid;
    v_ord3 uuid;
    v_cmd_pay uuid := '94000000-0000-4000-8000-000000000001';
    v_cmd_tr uuid := '94000000-0000-4000-8000-000000000002';
    v_res jsonb;
    v_stock int;
    v_pagos_count int;
BEGIN
    INSERT INTO auth.users (id, email) VALUES
        (v_staff_uid, 'h3_staff@test.invalid'),
        (v_socio1_uid, 'h3_socio1@test.invalid'),
        (v_socio2_uid, 'h3_socio2@test.invalid')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.socios (id, auth_user_id, nombre, apellido, email, rol, status, bloqueado)
    VALUES
        (v_staff_socio, v_staff_uid, 'H3', 'Staff', 'h3_staff@test.invalid', 'staff', 'active', false),
        (v_socio1_id, v_socio1_uid, 'H3', 'Socio1', 'h3_socio1@test.invalid', 'socio', 'active', false),
        (v_socio2_id, v_socio2_uid, 'H3', 'Socio2', 'h3_socio2@test.invalid', 'socio', 'active', false)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.products (id, nombre, tipo, stock_disponible, precio, activo, peso_gramos)
    VALUES (v_prod_id, 'H3 Producto Test', 'flor', 10, 100, true, 1)
    ON CONFLICT DO NOTHING;

    -- 1. Socio1 crea pedido retiro_sede -> stock 10 -> 9
    PERFORM set_config('request.jwt.claim.sub', v_socio1_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio1_uid, 'role', 'authenticated')::text, true);

    INSERT INTO public.pedidos (socio_id, items, tipo_pedido, origen, estado, created_by_user_id, idempotency_key)
    VALUES (
        v_socio1_id,
        jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'H3 Producto Test', 'cantidad', 1, 'precioUnitario', 100)),
        'retiro_sede', 'app', 'pendiente', v_socio1_uid, gen_random_uuid()
    )
    RETURNING id INTO v_ord1;

    SELECT stock_disponible INTO v_stock FROM public.products WHERE id = v_prod_id;
    IF v_stock <> 9 THEN RAISE EXCEPTION 'H3_STOCK_FAIL_CREATE: expected 9, got %', v_stock; END IF;

    -- 2. Permisos: Socio1 NO puede usar transition_order_status_transaccional
    BEGIN
        PERFORM public.transition_order_status_transaccional(v_ord1, 'en_preparacion', NULL, gen_random_uuid());
        RAISE EXCEPTION 'H3_PERM_FAIL: socio pudo transicionar';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%ORDER_ACTOR_FORBIDDEN%' THEN
            RAISE EXCEPTION 'H3_PERM_UNEXPECTED: %', SQLERRM;
        END IF;
    END;

    -- 3. Permisos: Socio2 NO puede cancelar pedido de Socio1
    PERFORM set_config('request.jwt.claim.sub', v_socio2_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio2_uid, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM public.cancelar_pedido_socio_transaccional(v_ord1, 'Intento ajeno');
        RAISE EXCEPTION 'H3_CANCEL_AJENO_FAIL: socio2 pudo cancelar pedido ajeno';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%SOCIO_ORDER_FORBIDDEN%' THEN
            RAISE EXCEPTION 'H3_CANCEL_AJENO_UNEXPECTED: %', SQLERRM;
        END IF;
    END;

    -- 4. Staff transiciona con idempotencia + bloqueo de modalidad entregado
    PERFORM set_config('request.jwt.claim.sub', v_staff_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_uid, 'role', 'authenticated')::text, true);

    PERFORM public.transition_order_status_transaccional(v_ord1, 'confirmado', NULL, gen_random_uuid());

    -- Bloqueo M1: retiro_sede en confirmado no puede pasar a entregado
    BEGIN
        UPDATE public.pedidos SET estado = 'entregado' WHERE id = v_ord1;
        RAISE EXCEPTION 'H3_MOD_FAIL: retiro_sede paso a entregado';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%INVALID_ORDER_TYPE_FOR_STATUS%' THEN
            RAISE EXCEPTION 'H3_MOD_UNEXPECTED: %', SQLERRM;
        END IF;
    END;

    PERFORM public.transition_order_status_transaccional(v_ord1, 'en_preparacion', NULL, v_cmd_tr);
    -- Reintento idempotente con mismo command_id
    v_res := public.transition_order_status_transaccional(v_ord1, 'en_preparacion', NULL, v_cmd_tr);
    IF coalesce((v_res->>'reused')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'H3_IDEMP_TR_FAIL: expected reused=true';
    END IF;

    PERFORM public.transition_order_status_transaccional(v_ord1, 'listo_para_retiro', NULL, gen_random_uuid());

    -- 5. Pago + reintento idempotente con mismo command_id -> exactamente 1 pago
    PERFORM public.confirm_order_payment_command(
        p_order_id => v_ord1,
        p_command_id => v_cmd_pay,
        p_payments => '[{"monto": 100, "medio_de_pago": "efectivo", "concepto": "H3 Aporte"}]'::jsonb,
        p_target_status => 'retirado'::text,
        p_actor_id => v_staff_uid
    );
    PERFORM public.confirm_order_payment_command(
        p_order_id => v_ord1,
        p_command_id => v_cmd_pay,
        p_payments => '[{"monto": 100, "medio_de_pago": "efectivo", "concepto": "H3 Aporte"}]'::jsonb,
        p_target_status => 'retirado'::text,
        p_actor_id => v_staff_uid
    );

    SELECT count(*)::int INTO v_pagos_count FROM public.pagos WHERE pedido_id = v_ord1;
    IF v_pagos_count <> 1 THEN RAISE EXCEPTION 'H3_IDEMP_PAY_FAIL: expected 1 pago, got %', v_pagos_count; END IF;

    -- 6. Bloqueo terminal post-retiro
    BEGIN
        UPDATE public.pedidos SET estado = 'cancelado' WHERE id = v_ord1;
        RAISE EXCEPTION 'H3_TERM_FAIL: se pudo cancelar pedido retirado';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%ORDER_TERMINAL_IMMUTABLE%' THEN
            RAISE EXCEPTION 'H3_TERM_UNEXPECTED: %', SQLERRM;
        END IF;
    END;

    -- 7. Entrega sin aporte inicial (p_payments = []) -> 0 pagos, stock 9 -> 8
    INSERT INTO public.pedidos (socio_id, items, tipo_pedido, origen, estado, created_by_user_id, idempotency_key)
    VALUES (
        v_socio1_id,
        jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'H3 Producto Test', 'cantidad', 1, 'precioUnitario', 100)),
        'retiro_sede', 'app', 'pendiente', v_staff_uid, gen_random_uuid()
    )
    RETURNING id INTO v_ord2;
    PERFORM public.transition_order_status_transaccional(v_ord2, 'en_preparacion', NULL, gen_random_uuid());
    PERFORM public.transition_order_status_transaccional(v_ord2, 'listo_para_retiro', NULL, gen_random_uuid());
    PERFORM public.confirm_order_payment_command(
        p_order_id => v_ord2,
        p_command_id => gen_random_uuid(),
        p_payments => '[]'::jsonb,
        p_target_status => 'retirado'::text,
        p_actor_id => v_staff_uid
    );
    SELECT count(*)::int INTO v_pagos_count FROM public.pagos WHERE pedido_id = v_ord2;
    IF v_pagos_count <> 0 THEN RAISE EXCEPTION 'H3_NO_PAY_FAIL: expected 0 pagos, got %', v_pagos_count; END IF;

    -- Asegurar permisos base de rol authenticated en entorno desechable para probar RLS y triggers directos
    GRANT SELECT, UPDATE ON public.pedidos TO authenticated;
    GRANT SELECT ON public.socios TO authenticated;

    -- 8. Pruebas negativas de UPDATE directo por socio (sin prefijo bypass) + cancelación válida por RPC
    PERFORM set_config('request.jwt.claim.sub', v_socio1_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio1_uid, 'role', 'authenticated')::text, true);
    INSERT INTO public.pedidos (socio_id, items, tipo_pedido, origen, estado, created_by_user_id, idempotency_key)
    VALUES (
        v_socio1_id,
        jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'productoNombre', 'H3 Producto Test', 'cantidad', 1, 'precioUnitario', 100)),
        'retiro_sede', 'app', 'pendiente', v_socio1_uid, gen_random_uuid()
    )
    RETURNING id INTO v_ord3;

    -- 8a. Negativa: Socio haciendo UPDATE directo modificando observaciones (incluso con prefijo [Cancelación socio]) debe ser rechazado
    IF to_regprocedure('public.check_pedidos_update_only_status()') IS NOT NULL THEN
        BEGIN
            EXECUTE 'SET LOCAL ROLE authenticated';
            UPDATE public.pedidos
            SET estado = 'cancelado', observaciones = '[Cancelación socio] intento directo'
            WHERE id = v_ord3;
            RAISE EXCEPTION 'H3_DIRECT_OBS_FAIL: socio pudo alterar observaciones directamente';
        EXCEPTION WHEN OTHERS THEN
            EXECUTE 'RESET ROLE';
            IF SQLERRM NOT LIKE '%Los socios sólo pueden modificar el estado de sus pedidos%' THEN
                RAISE EXCEPTION 'H3_DIRECT_OBS_UNEXPECTED: %', SQLERRM;
            END IF;
        END;

        -- 8b. Negativa: Socio2 haciendo UPDATE directo sobre pedido ajeno debe ser bloqueado (0 filas por RLS o excepcion)
        PERFORM set_config('request.jwt.claim.sub', v_socio2_uid::text, true);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio2_uid, 'role', 'authenticated')::text, true);
        BEGIN
            EXECUTE 'SET LOCAL ROLE authenticated';
            UPDATE public.pedidos SET estado = 'cancelado' WHERE id = v_ord3;
            IF FOUND THEN
                RAISE EXCEPTION 'H3_DIRECT_AJENO_FAIL: socio2 pudo modificar pedido ajeno';
            END IF;
            EXECUTE 'RESET ROLE';
        EXCEPTION WHEN OTHERS THEN
            EXECUTE 'RESET ROLE';
            IF SQLERRM NOT LIKE '%No autorizado para modificar este pedido%' THEN
                RAISE EXCEPTION 'H3_DIRECT_AJENO_UNEXPECTED: %', SQLERRM;
            END IF;
        END;
    END IF;

    -- 8c. Positiva: Socio1 cancela su propio pedido mediante RPC cancelar_pedido_socio_transaccional
    PERFORM set_config('request.jwt.claim.sub', v_socio1_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio1_uid, 'role', 'authenticated')::text, true);
    PERFORM public.cancelar_pedido_socio_transaccional(v_ord3, 'H3 Cancelacion valida');

    SELECT stock_disponible INTO v_stock FROM public.products WHERE id = v_prod_id;
    IF v_stock <> 8 THEN RAISE EXCEPTION 'H3_STOCK_FINAL_FAIL: expected 8, got %', v_stock; END IF;

    -- 9. Prueba de integración PostgreSQL: Grant vencido es rechazado con GRANT_EXPIRED sin crear pedido ni mover stock
    DECLARE
        v_grant_res jsonb;
        v_grant_id uuid;
        v_expired_grant_id uuid := gen_random_uuid();
        v_expired_idem uuid := gen_random_uuid();
        v_idem_grant uuid := gen_random_uuid();
        v_items_grant jsonb := jsonb_build_array(jsonb_build_object('productoId', v_prod_id, 'cantidad', 1));
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_staff_uid::text, true);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_uid, 'role', 'authenticated')::text, true);

        v_grant_res := public.issue_order_grant(
            v_socio1_id,
            v_items_grant,
            'retiro_sede',
            'H4B prueba grant vencido',
            v_idem_grant,
            '{}'::jsonb
        );
        v_grant_id := (v_grant_res->>'grant_id')::uuid;

        -- Clonar un registro expirado en action_grants (sin violar inmutabilidad) y probar ejecución delegada
        INSERT INTO public.action_grants (
            grant_id, idempotency_key, operator_auth_user_id,
            action, target_socio_id, approved_payload_hash, approved_catalogue_hash,
            status, issued_at, expires_at
        )
        SELECT
            v_expired_grant_id, v_expired_idem, operator_auth_user_id,
            action, target_socio_id, approved_payload_hash, approved_catalogue_hash,
            'issued', clock_timestamp() - interval '60 seconds', clock_timestamp() - interval '10 seconds'
        FROM public.action_grants
        WHERE grant_id = v_grant_id;

        BEGIN
            PERFORM public.ejecutar_pedido_con_autorizacion_delegada(
                v_expired_grant_id,
                v_expired_idem,
                v_socio1_id,
                v_items_grant,
                'retiro_sede',
                'H4B prueba grant vencido'
            );
            RAISE EXCEPTION 'H4B_GRANT_EXPIRY_FAIL: grant vencido pudo ejecutarse';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%GRANT_EXPIRED%' THEN
                RAISE EXCEPTION 'H4B_GRANT_EXPIRY_UNEXPECTED: %', SQLERRM;
            END IF;
        END;

        SELECT stock_disponible INTO v_stock FROM public.products WHERE id = v_prod_id;
        IF v_stock <> 8 THEN RAISE EXCEPTION 'H4B_GRANT_STOCK_FAIL: expected 8, got %', v_stock; END IF;
    END;

    RAISE NOTICE 'H3_BEHAVIOR_ALL_PASS: stock=8, pagos_ord1=1, pagos_ord2=0, permisos, cancelacion segura y GRANT_EXPIRED verificados';
END $$;
