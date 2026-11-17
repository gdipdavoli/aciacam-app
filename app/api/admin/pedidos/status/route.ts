import { orderRoute } from '@/app/lib/agent/order-runtime';
export const GET=(request:Request)=>orderRoute(request,'status');
