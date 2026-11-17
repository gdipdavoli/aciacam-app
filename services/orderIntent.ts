export interface IntentStorage { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem(key:string):void; }
export function retainOrderIntent(storage:IntentStorage,actor:string,payload:unknown,uuid:()=>string):{key:string;complete:()=>void} {
    const namespace=`aciacam_order_intent_v1:${actor}`;
    const content=JSON.stringify(payload);
    const raw=storage.getItem(namespace);
    const prior=raw?JSON.parse(raw):null;
    if(prior && prior.payload!==content) throw new Error('ORDER_INTENT_UNCERTAIN: resolver el intento pendiente antes de cambiar el pedido');
    const entry=prior || {key:uuid(),payload:content};
    if(!/^[0-9a-f-]{36}$/i.test(entry.key)) throw new Error('ORDER_INTENT_INVALID');
    storage.setItem(namespace,JSON.stringify(entry));
    return {key:entry.key,complete:()=>storage.removeItem(namespace)};
}
