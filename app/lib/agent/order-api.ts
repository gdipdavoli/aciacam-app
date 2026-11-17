import { timingSafeEqual, randomUUID } from 'crypto';
import { consolidateOrderItems, canonicalUuid } from './pedidos-tool-core';

export type OrderAction = 'issue' | 'revoke' | 'execute' | 'status' | 'human-status' | 'validate';
export interface OrderApiDependencies {
    enabled: boolean;
    s2sSecret: string;
    authenticate(request: Request): Promise<{ id: string; client: any; response?: Response } | null>;
    admin(): any;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const detailsKeys = ['direccion_entrega','localidad','fecha_retiro','franja_horaria','slot_id','observaciones'];
function order(body: any, optionalKey=false) {
    if (!body || !['delivery','retiro_sede'].includes(body.tipo_pedido)) throw Error('INVALID_ORDER_TYPE');
    const details: Record<string, string> = {};
    for (const key of detailsKeys) if (body[key] != null) {
        if (typeof body[key] !== 'string') throw Error('INVALID_ORDER_DETAILS');
        details[key] = body[key];
    }
    return { socio: canonicalUuid(body.socio_id), items: consolidateOrderItems(body.items), type: body.tipo_pedido,
        motive: String(body.motivo || '').trim(), key:optionalKey && body.idempotency_key==null ? null : canonicalUuid(body.idempotency_key), details };
}
export async function handleOrderAction(request: Request, action: OrderAction, deps: OrderApiDependencies): Promise<Response> {
    let attempt: {db:any;grantId:string;key:string;id:string} | undefined;
    try {
        const human = action === 'issue' || action === 'revoke' || action === 'human-status';
        let actor: Awaited<ReturnType<OrderApiDependencies['authenticate']>> = null;
        if (human) {
            if(request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) return json({code:'ORIGIN_FORBIDDEN'},403);
            actor = await deps.authenticate(request);
            if (!actor) return json({ code: 'UNAUTHORIZED' }, 401);
        } else {
            const supplied = Buffer.from(request.headers.get('X-Agent-Core-Secret') || '');
            const expected = Buffer.from(deps.s2sSecret);
            if (expected.length < 16 || supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) {
                return json({ code: 'S2S_UNAUTHORIZED' }, 401);
            }
        }
        if (!deps.enabled && action !== 'status' && action !== 'revoke' && action !== 'human-status' && action !== 'validate') return json({ code:'AGENT_ORDER_EXECUTION_DISABLED' },503);
        const body = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json();
        if(action==='human-status') {
            const {data,error}=await actor!.client.rpc('read_order_grant',{p_grant_id:canonicalUuid(body.grant_id)});
            if(error) return json({code:'GRANT_READ_DENIED'},403);
            return json(data);
        }
        if (action === 'revoke') {
            const { data,error } = await actor!.client.rpc('revoke_order_grant', {p_grant_id:canonicalUuid(body.grant_id),p_reason:body.reason});
            if (error) return json({code:'GRANT_REVOCATION_DENIED'},403);
            return json(data);
        }
        if (action === 'issue') {
            if (body.actor_id || body.operator_auth_user_id || body.approved_payload_hash || body.origen) return json({code:'CLIENT_AUTHORITY_FORBIDDEN'},400);
            const p=order(body);
            const {data,error}=await actor!.client.rpc('issue_order_grant',{p_socio_id:p.socio,p_items:p.items,p_tipo_pedido:p.type,p_motivo:p.motive,p_idempotency_key:p.key,p_details:p.details});
            if(error) return json({code:'GRANT_ISSUANCE_DENIED'},403);
            return json(data,201);
        }
        const db=deps.admin();
        if(action==='validate') {
            const p=order(body,true);
            const {data,error}=await db.rpc('validate_order_proposal',{p_socio:p.socio,p_items:p.items,p_type:p.type,p_address:p.details.direccion_entrega || null,p_city:p.details.localidad || null});
            if(error) return json({valid:false,code:'ORDER_VALIDATION_DENIED'},409);
            
            const catalogue: any[] = Array.isArray(data?.catalogue) ? data.catalogue : [];
            let floresG = 0;
            let goterosU = 0;
            const stockPreflight = catalogue.map((cat: any) => {
                const qty = Number(cat.cantidad || 0);
                const stock = Number(cat.stock || 0);
                const peso = Number(cat.peso_gramos || 0);
                const tipo = String(cat.tipo || '').toLowerCase();
                if (tipo.includes('flor')) {
                    floresG += qty * peso;
                } else if (tipo.includes('gotero') || tipo.includes('aceite')) {
                    goterosU += qty;
                }
                return {
                    productoId: cat.productoId,
                    cantidadSolicitada: qty,
                    stockDisponibleActual: stock,
                    suficiente: stock >= qty
                };
            });
            const compliant = floresG <= 40 && goterosU <= 6;
            const warning = !compliant ? `Excede el límite legal de la Res. 800/2021 (${floresG}g flor / ${goterosU} goteros)` : undefined;

            return json({
                valid: Boolean(data?.valid) && stockPreflight.every(s => s.suficiente) && compliant,
                socio_status: 'active',
                socio_bloqueado: false,
                envios_habilitados: true,
                stock_preflight: stockPreflight,
                transport_evaluation: {
                    flores_g: floresG,
                    goteros_u: goterosU,
                    compliant,
                    warning
                },
                errors: !compliant ? [warning!] : [],
                warnings: [],
                verified_at: new Date().toISOString(),
                notice: data?.notice || 'La validacion no reserva stock ni autoriza ejecucion.'
            });
        }
        const grantId=canonicalUuid(body.grant_id || body.action_grant?.payload?.grant_id);
        const {data:grant,error:grantError}=await db.from('action_grants').select('*').eq('grant_id',grantId).maybeSingle();
        if(grantError) return json({code:'GRANT_LOOKUP_UNAVAILABLE'},503);
        if(!grant) return json({code:'GRANT_NOT_FOUND'},404);
        if(request.headers.get('X-Delegated-Auth-User-Id')!==grant.operator_auth_user_id) return json({code:'GRANT_ACTOR_MISMATCH'},403);
        if(action==='status') {
            const recorded=await db.rpc('read_order_execution_status',{p_grant_id:grantId,p_actor:grant.operator_auth_user_id});
            if(recorded.error) return json({code:'ORDER_STATUS_UNAVAILABLE'},503);
            return json({operation_state:recorded.data,grant_id:grantId,correlation_id:grant.correlation_id,
                pedido_id:grant.revoked_at?null:grant.pedido_id || null,found:!grant.revoked_at && !!grant.pedido_id,terminal:grant.status==='executed'});
        }
        const p=order(body);
        if(p.socio!==grant.target_socio_id || p.key!==grant.idempotency_key || grant.action!=='execute_order') return json({code:'GRANT_SCOPE_MISMATCH'},403);
        // Database recomputes the approved hash while holding the durable grant lock.
        const args={p_grant_id:grantId,p_idempotency_key:p.key,p_socio_id:p.socio,p_items:p.items,p_tipo_pedido:p.type,p_motivo:p.motive,
          p_direccion_entrega:p.details.direccion_entrega || null,p_localidad:p.details.localidad || null,p_fecha_retiro:p.details.fecha_retiro || null,
          p_franja_horaria:p.details.franja_horaria || null,p_slot_id:p.details.slot_id || null,p_observaciones:p.details.observaciones || null};
        attempt={db,grantId,key:p.key!,id:randomUUID()};
        const stamp=(s:string,error:string|null=null)=>db.rpc('record_order_attempt',{p_grant_id:grantId,p_key:p.key,p_attempt_id:attempt!.id,p_state:s,p_error:error});
        const started=await stamp('PENDING');
        if(started.error) return json({code:'ATTEMPT_LEDGER_UNAVAILABLE',operation_state:'UNCERTAIN'},503);
        const {data,error}=await db.rpc('ejecutar_pedido_con_autorizacion_delegada',args);
        if(error) {
            const known=['22023','23505','42501','P0001'].includes(error.code || '');
            await stamp(known?'FAILED':'UNCERTAIN',known?'SQL_REJECTION':'BACKEND_UNCERTAIN');
            return json({code:known?'ORDER_EXECUTION_REJECTED':'ORDER_RESULT_UNCERTAIN',operation_state:known?'FAILED':'UNCERTAIN',correlation_id:grant.correlation_id},known?409:502);
        }
        if(!data?.success || !data.pedido_id) return json({code:'ORDER_RESULT_UNCONFIRMED',operation_state:'UNCERTAIN'},502);
        const finished=await stamp('CONFIRMED');
        if(finished.error) return json({code:'ATTEMPT_RESULT_UNCERTAIN',operation_state:'UNCERTAIN'},502);
        return json({success:true,pedido_id:data.pedido_id,estado:data.pedido?.estado || data.estado,
          deduplicated:!!data.deduplicated,idempotency_key:p.key,correlation_id:grant.correlation_id,operation_state:'CONFIRMED'});
    } catch {
        if(attempt) {
            try {await attempt.db.rpc('record_order_attempt',{p_grant_id:attempt.grantId,p_key:attempt.key,p_attempt_id:attempt.id,p_state:'UNCERTAIN',p_error:'BACKEND_TRANSPORT'});} catch { /* Durable PENDING remains uncertain; never report success. */ }
        }
        return json({code:'ORDER_REQUEST_INVALID_OR_UNCERTAIN',operation_state:'UNCERTAIN'},502);
    }
}
