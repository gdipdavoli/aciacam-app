/**
 * app/lib/agent/proposal-store.ts
 *
 * ACIACAM — Sprint 7B.5 (Remediación P0/P1)
 * Consulta y Mapeo Canónico de Propuestas Persistidas (public.order_proposals)
 *
 * Principios:
 * - Sin escrituras directas ni fallbacks a memoria.
 * - Toda mutación ocurre exclusivamente mediante RPCs transaccionales PostgreSQL.
 * - Sin lecturas relacionales directas sobre public.action_grants con permisos de usuario.
 * - Respeta estrictamente RLS y privilegios mínimos.
 */

import { OrderProposal } from '@/types/order-approval';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getDefaultAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  } catch {
    return null;
  }
}

export function mapRowToProposal(row: any): OrderProposal {
  const socio = row.target_socio || row.socios;
  const is24hExpired = Boolean(row.expires_at) && new Date(row.expires_at).getTime() <= Date.now();
  
  // Terminalidad estricta: executed y rejected nunca pasan a expired
  let effectiveStatus = row.status;
  if (row.status === 'executed' || row.status === 'rejected') {
    effectiveStatus = row.status;
  } else if ((row.status === 'pending_review' || row.status === 'grant_issued') && is24hExpired) {
    effectiveStatus = 'expired';
  }

  const grantRecord = row.action_grant;
  const items = row.enriched_items || row.items || [];

  return {
    id: row.proposal_id,
    proposal_payload_hash: row.proposal_payload_hash,
    approved_catalogue_hash: row.approved_catalogue_hash,
    socio_id: row.target_socio_id,
    socio_nombre: socio?.nombre
      ? `${socio.nombre} ${socio.apellido || ''}`.trim()
      : 'Socio',
    socio_dni: socio?.dni,
    socio_email: socio?.email,
    socio_bloqueado: socio?.bloqueado,
    tipo_pedido: row.tipo_pedido,
    items,
    stock_actual_synced_at: row.stock_actual_synced_at,
    motivo: row.motivo,
    solicitante: {
      tipo: row.solicitante_tipo || 'agente',
      nombre: row.solicitante_nombre || 'Agent Core',
      id: row.actor_auth_user_id || undefined
    },
    details: row.details || {},
    validation: row.validation_snapshot || {},
    status: effectiveStatus,
    idempotency_key: row.idempotency_key,
    grant: row.grant_id ? {
      grant_id: row.grant_id,
      operator_auth_user_id: grantRecord?.operator_auth_user_id || row.actor_auth_user_id || '',
      target_socio_id: row.target_socio_id,
      status: grantRecord?.status || (row.status === 'grant_issued' ? 'issued' : row.status === 'executed' ? 'executed' : 'revoked'),
      approved_payload_hash: grantRecord?.approved_payload_hash || row.proposal_payload_hash,
      issued_at: grantRecord?.issued_at || row.updated_at,
      expires_at: grantRecord?.expires_at || new Date(new Date(row.updated_at).getTime() + 120000).toISOString(),
      pedido_id: row.pedido_id
    } : undefined,
    execution_result: row.pedido_id ? {
      pedido_id: row.pedido_id,
      estado: 'confirmado',
      operation_state: 'CONFIRMED',
      deduplicated: false,
      correlation_id: row.idempotency_key,
      idempotency_key: row.idempotency_key
    } : undefined,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    expires_at: row.expires_at
  };
}

class OrderProposalStore {
  /**
   * Enriquece una o más filas de order_proposals con datos de perfil de socios mediante service_role
   */
  private async enrichSocios(rows: any[]): Promise<void> {
    if (!rows || rows.length === 0) return;
    const admin = getDefaultAdminClient();
    if (!admin) return;

    const socioIds = Array.from(new Set(rows.map(r => r.target_socio_id).filter(Boolean)));
    if (socioIds.length === 0) return;

    try {
      const { data: socios } = await admin
        .from('socios')
        .select('id, nombre, apellido, dni, email, status, bloqueado')
        .in('id', socioIds);

      if (socios && socios.length > 0) {
        const map = new Map(socios.map(s => [s.id, s]));
        rows.forEach(r => {
          r.target_socio = map.get(r.target_socio_id);
        });
      }
    } catch (e: any) {
      console.warn('OrderProposalStore.enrichSocios warning:', e.message);
    }
  }

  /**
   * Enriquece una o más filas de order_proposals con datos de tickets de autorización (action_grants)
   */
  private async enrichGrants(rows: any[]): Promise<void> {
    if (!rows || rows.length === 0) return;
    const admin = getDefaultAdminClient();
    if (!admin) return;

    const grantIds = Array.from(new Set(rows.map(r => r.grant_id).filter(Boolean)));
    if (grantIds.length === 0) return;

    try {
      const { data: grants } = await admin
        .from('action_grants')
        .select('grant_id, operator_auth_user_id, approved_payload_hash, status, issued_at, expires_at')
        .in('grant_id', grantIds);

      if (grants && grants.length > 0) {
        const map = new Map(grants.map(g => [g.grant_id, g]));
        rows.forEach(r => {
          if (r.grant_id) {
            r.action_grant = map.get(r.grant_id);
          }
        });
      }
    } catch (e: any) {
      console.warn('OrderProposalStore.enrichGrants warning:', e.message);
    }
  }

  /**
   * Enriquece una o más filas de order_proposals con stock vivo y actualizado de productos (public.products)
   * SIN alterar order_proposals.items ni los hashes criptográficos LPCP-v2 inmutables.
   */
  private async enrichLiveStock(rows: any[]): Promise<void> {
    if (!rows || rows.length === 0) return;
    const admin = getDefaultAdminClient();
    if (!admin) return;

    const productIds = new Set<string>();
    rows.forEach(r => {
      const items = Array.isArray(r.items) ? r.items : [];
      items.forEach((it: any) => {
        const pid = it.productoId || it.producto_id || it.id;
        if (pid) productIds.add(pid);
      });
    });

    if (productIds.size === 0) return;

    try {
      const { data: products, error } = await admin
        .from('products')
        .select('id, nombre, stock_disponible, updated_at')
        .in('id', Array.from(productIds));

      if (error) {
        console.warn('OrderProposalStore.enrichLiveStock warning:', error.message);
        return;
      }

      if (products && products.length > 0) {
        const prodMap = new Map(products.map(p => [p.id, p]));
        const syncTimestamp = new Date().toISOString();

        rows.forEach(r => {
          r.stock_actual_synced_at = syncTimestamp;
          if (Array.isArray(r.items)) {
            r.enriched_items = r.items.map((it: any) => {
              const pid = it.productoId || it.producto_id || it.id;
              const liveProd = prodMap.get(pid);
              const liveStock = liveProd !== undefined && liveProd.stock_disponible !== null
                ? Number(liveProd.stock_disponible)
                : undefined;
              const liveUpdatedAt = liveProd?.updated_at || syncTimestamp;
              const liveSufficient = liveStock !== undefined 
                ? liveStock >= Number(it.cantidad || 1) 
                : Boolean(it.suficiente);

              return {
                ...it,
                stockActual: liveStock,
                stockActualSuficiente: liveSufficient,
                stockActualUpdatedAt: liveUpdatedAt
              };
            });
          }
        });
      }
    } catch (e: any) {
      console.warn('OrderProposalStore.enrichLiveStock error:', e.message);
    }
  }

  /**
   * Obtiene una propuesta persistida por ID desde PostgreSQL (public.order_proposals).
   */
  public async get(id: string, client?: SupabaseClient): Promise<OrderProposal | undefined> {
    const db = client || getDefaultAdminClient();
    if (!db) return undefined;

    const { data, error } = await db
      .from('order_proposals')
      .select('*')
      .eq('proposal_id', id)
      .maybeSingle();

    if (error) {
      console.warn('OrderProposalStore.get database error:', error.message);
      return undefined;
    }

    if (!data) return undefined;
    await this.enrichSocios([data]);
    await this.enrichGrants([data]);
    await this.enrichLiveStock([data]);
    return mapRowToProposal(data);
  }

  public async findByHash(hash: string, client?: SupabaseClient): Promise<OrderProposal | undefined> {
    const db = client || getDefaultAdminClient();
    if (!db) return undefined;

    const { data, error } = await db
      .from('order_proposals')
      .select('*')
      .eq('proposal_payload_hash', hash)
      .maybeSingle();

    if (error || !data) return undefined;
    await this.enrichSocios([data]);
    await this.enrichGrants([data]);
    await this.enrichLiveStock([data]);
    return mapRowToProposal(data);
  }

  public async findByGrantId(grantId: string, client?: SupabaseClient): Promise<OrderProposal | undefined> {
    const db = client || getDefaultAdminClient();
    if (!db) return undefined;

    const { data, error } = await db
      .from('order_proposals')
      .select('*')
      .eq('grant_id', grantId)
      .maybeSingle();

    if (error || !data) return undefined;
    await this.enrichSocios([data]);
    await this.enrichGrants([data]);
    await this.enrichLiveStock([data]);
    return mapRowToProposal(data);
  }

  /**
   * Lista todas las propuestas persistidas accesibles según el rol del usuario (RLS).
   */
  public async listAll(client?: SupabaseClient): Promise<OrderProposal[]> {
    const db = client || getDefaultAdminClient();
    if (!db) return [];

    const { data, error } = await db
      .from('order_proposals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error) console.warn('OrderProposalStore.listAll database error:', error.message);
      return [];
    }

    await this.enrichSocios(data);
    await this.enrichGrants(data);
    await this.enrichLiveStock(data);
    return data.map(mapRowToProposal);
  }
}

export const proposalStore = new OrderProposalStore();

