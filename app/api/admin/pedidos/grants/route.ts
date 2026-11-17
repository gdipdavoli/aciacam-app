import { orderRoute } from '@/app/lib/agent/order-runtime';
export const POST=(request:Request)=>orderRoute(request,'issue');
export const DELETE=(request:Request)=>orderRoute(request,'revoke');
export const GET=(request:Request)=>orderRoute(request,'human-status');
