import { ActionGrantToken, GrantConsumptionResult, GrantExecutionRecord } from '@/types/pedidos-tool';

/** Compatibility interface only. PostgreSQL is the sole execution authority. */
export interface IActionGrantStore {
    registerGrant(token:ActionGrantToken):Promise<void>;
    consumeGrantAtomic(token:ActionGrantToken,hash:string,key:string,secret:string):Promise<GrantConsumptionResult>;
    recordExecutionSuccess(grantId:string,key:string,pedidoId:string,result:unknown):Promise<void>;
    getRecord(grantId:string):Promise<GrantExecutionRecord|null>;
    clear():Promise<void>;
}

/** @deprecated Intentionally fail-closed: a signed token cannot create its own approval. */
export class InMemoryActionGrantStore implements IActionGrantStore {
    async registerGrant(_token:ActionGrantToken):Promise<void> { throw new Error('PERSISTENT_GRANT_AUTHORITY_REQUIRED'); }
    async consumeGrantAtomic(_token:ActionGrantToken,_hash:string,_key:string,_secret:string):Promise<GrantConsumptionResult> {
        throw new Error('PERSISTENT_GRANT_AUTHORITY_REQUIRED');
    }
    async recordExecutionSuccess(_grantId:string,_key:string,_pedidoId:string,_result:unknown):Promise<void> {
        throw new Error('PERSISTENT_GRANT_AUTHORITY_REQUIRED');
    }
    async getRecord(_grantId:string):Promise<GrantExecutionRecord|null> { throw new Error('PERSISTENT_GRANT_AUTHORITY_REQUIRED'); }
    async clear():Promise<void> { /* No business state is retained in memory. */ }
}
export const defaultActionGrantStore=new InMemoryActionGrantStore();
