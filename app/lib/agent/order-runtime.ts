import { createClient } from '@supabase/supabase-js';
import { authenticate } from '@/app/lib/agent/order-auth';
import { handleOrderAction, OrderAction } from './order-api';
export async function orderRoute(request: Request,action: OrderAction): Promise<Response> {
    let authResponse: any;
    const admin=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const response=await handleOrderAction(request,action,{
        enabled:process.env.AGENT_CORE_ENABLED==='true' && process.env.AGENT_ORDER_EXECUTION_ENABLED==='true',
        s2sSecret:process.env.AGENT_ORDER_CALLBACK_SECRET || process.env.AGENT_CORE_BFF_SECRET || '',admin,
        async authenticate(req) {
            const auth=await authenticate(req,admin());
            authResponse=auth.authResponse;
            return auth.success && auth.userClient ? {id:auth.id,client:auth.userClient} : null;
        }
    });
    if(authResponse) {
        // Response is the real handler response, not a replacement which drops refreshed cookies.
        for(const cookie of authResponse.headers.getSetCookie()) response.headers.append('set-cookie',cookie);
    }
    return response;
}
