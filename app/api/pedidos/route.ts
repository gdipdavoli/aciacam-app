import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate } from '@/app/lib/agent/order-auth';
import { preserveSupabaseAuthResponse } from '@/app/lib/supabase/auth-response';
export async function POST(request:NextRequest) {
    if(request.headers.get('origin')!==request.nextUrl.origin) return NextResponse.json({code:'ORIGIN_FORBIDDEN'},{status:403});
    const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const auth=await authenticate(request,admin);
    if(!auth.success) return auth.response;
    const respond=(data:unknown,status=200)=>preserveSupabaseAuthResponse(NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}}),auth.authResponse);
    if(!auth.userClient) return respond({code:'UNAUTHORIZED'},401);
    try {
        const body=await request.json();
        if(body.actor_id || body.origen || body.estado || body.details?.origen || body.details?.estado) return respond({code:'CLIENT_AUTHORITY_FORBIDDEN'},400);
        const key=request.headers.get('Idempotency-Key') || body.idempotencyKey;
        if(typeof key!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return respond({code:'INVALID_IDEMPOTENCY_KEY'},400);
        const d=body.details || {};
        const {data,error}=await auth.userClient.rpc('crear_pedido_socio_transaccional',{
          p_idempotency_key:key,p_items:body.items,p_tipo_pedido:body.tipo,
          p_direccion_entrega:d.direccionEntrega || null,p_localidad:d.localidad || null,
          p_fecha_retiro:d.fechaRetiroPreferida || null,p_franja_horaria:d.franjaHoraria || null,
          p_slot_id:d.slotId || null,p_observaciones:d.observaciones || null
        });
        if(error) {
            const known=['22023','23505','42501','P0001'].includes(error.code || '');
            return respond({code:known?'ORDER_REJECTED':'ORDER_RESULT_UNCERTAIN',operation_state:known?'FAILED':'UNCERTAIN'},known?409:502);
        }
        if(!data?.success || !data.pedido?.id) return respond({code:'ORDER_RESULT_UNCERTAIN'},502);
        return respond(data,data.deduplicated?200:201);
    } catch { return respond({code:'ORDER_RESULT_UNCERTAIN'},502); }
}
