import { NextRequest, NextResponse } from 'next/server';
import { getDelegatedBffContext, withBffAuthResponse } from '@/app/lib/agent/bff-auth';
export async function POST(request:NextRequest) {
    if(request.headers.get('origin')!==request.nextUrl.origin) return NextResponse.json({code:'ORIGIN_FORBIDDEN'},{status:403});
    const auth=await getDelegatedBffContext(request);
    if(!auth.success) return auth.response;
    const respond=(body:unknown,status=200)=>withBffAuthResponse(auth,NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}}));
    if(process.env.AGENT_CORE_ENABLED!=='true' || process.env.AGENT_ORDER_EXECUTION_ENABLED!=='true') return respond({code:'AGENT_ORDER_EXECUTION_DISABLED'},503);
    try {
        const body=await request.json();
        if(body.actor_id || body.requested_by || body.operator_auth_user_id || body.role) return respond({code:'CLIENT_AUTHORITY_FORBIDDEN'},400);
        const result=await fetch(`${auth.context.agentCoreBaseUrl}/api/v1/orchestration/delegated-order`,{
            method:'POST',headers:{...auth.context.s2sHeaders,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
        });
        if(!result.ok) return respond({code:'ORDER_RESULT_UNCERTAIN'},502);
        const envelope=await result.json();
        const data=envelope.capability_result;
        if(envelope.status!=='COMPLETED' || data?.operation_state!=='CONFIRMED') return respond({code:'ORDER_RESULT_UNCERTAIN'},502);
        return respond(data);
    } catch {return respond({code:'ORDER_RESULT_UNCERTAIN'},502);}
}
