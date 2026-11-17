import { orderRoute } from '@/app/lib/agent/order-runtime';
export const POST=(request:Request)=>orderRoute(request,'validate');
