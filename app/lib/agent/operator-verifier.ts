/**
 * app/lib/agent/operator-verifier.ts
 *
 * ACIACAM — Sprint 7B.4 (Etapa 2)
 * Verificador de Identidad y Permisos del Operador en Tiempo de Ejecución (Execution-Time Guard)
 *
 * Directiva:
 * Verificar la identidad y permisos del operador en el momento exacto de ejecutar,
 * no únicamente al momento de emitir el ActionGrantToken.
 * Si el operador fue revocado, suspendido o bloqueado durante los 120s de validez del token,
 * la ejecución debe abortarse inmediatamente.
 */

import { OperatorVerificationResult } from '@/types/pedidos-tool';
import { SupabaseClient } from '@supabase/supabase-js';

export interface IOperatorVerifier {
    verifyOperator(operatorAuthUserId: string): Promise<OperatorVerificationResult>;
}

export class SupabaseOperatorVerifier implements IOperatorVerifier {
    constructor(private supabaseAdmin: SupabaseClient) {}

    public async verifyOperator(operatorAuthUserId: string): Promise<OperatorVerificationResult> {
        if (!operatorAuthUserId || typeof operatorAuthUserId !== 'string') {
            return {
                valid: false,
                role: 'other',
                active: false,
                blocked: true,
                error: 'Identificador de operador no provisto o inválido',
                code: 'INVALID_OPERATOR_ID'
            };
        }

        const { data: socios, error } = await this.supabaseAdmin
            .from('socios')
            .select('id, rol, status, bloqueado, motivo_bloqueo')
            .eq('auth_user_id', operatorAuthUserId);

        if (error) {
            return {
                valid: false,
                role: 'other',
                active: false,
                blocked: false,
                error: `Error al consultar operador: ${error.message}`,
                code: 'DB_ERROR'
            };
        }

        if (!socios || socios.length === 0) {
            return {
                valid: false,
                role: 'other',
                active: false,
                blocked: false,
                error: 'Operador no registrado en la nómina de socios',
                code: 'OPERATOR_NOT_FOUND'
            };
        }

        const socio = socios[0];
        const role = String(socio.rol || '').toLowerCase().trim();
        const active = socio.status === 'active';
        const blocked = Boolean(socio.bloqueado);

        if (blocked) {
            return {
                valid: false,
                role: (role === 'admin' || role === 'staff') ? role : 'other',
                active,
                blocked: true,
                error: `OPERATOR_REVOKED: El operador se encuentra bloqueado administrativamente (${socio.motivo_bloqueo || 'Sin detalle'})`,
                code: 'OPERATOR_BLOCKED'
            };
        }

        if (!active) {
            return {
                valid: false,
                role: (role === 'admin' || role === 'staff') ? role : 'other',
                active: false,
                blocked: false,
                error: `OPERATOR_REVOKED: El operador no se encuentra en estado activo (estado actual: ${socio.status})`,
                code: 'OPERATOR_INACTIVE'
            };
        }

        if (role !== 'admin' && role !== 'staff') {
            return {
                valid: false,
                role: 'other',
                active,
                blocked,
                error: `OPERATOR_NOT_PERMITTED: El operador posee rol '${role}', carece de permisos administrativos para ordenar dispensas`,
                code: 'INSUFFICIENT_PERMISSIONS'
            };
        }

        return {
            valid: true,
            role: role as 'admin' | 'staff',
            active: true,
            blocked: false
        };
    }
}

/**
 * Verificador para pruebas y entornos controlados
 */
export class MockOperatorVerifier implements IOperatorVerifier {
    private operators = new Map<string, { role: 'admin' | 'staff' | 'socio'; active: boolean; blocked: boolean; motivo?: string }>();

    public setOperator(id: string, data: { role: 'admin' | 'staff' | 'socio'; active: boolean; blocked: boolean; motivo?: string }) {
        this.operators.set(id, data);
    }

    public async verifyOperator(operatorAuthUserId: string): Promise<OperatorVerificationResult> {
        const op = this.operators.get(operatorAuthUserId);
        if (!op) {
            return {
                valid: false,
                role: 'other',
                active: false,
                blocked: false,
                error: 'Operador no encontrado',
                code: 'OPERATOR_NOT_FOUND'
            };
        }

        if (op.blocked) {
            return {
                valid: false,
                role: (op.role === 'admin' || op.role === 'staff') ? op.role : 'other',
                active: op.active,
                blocked: true,
                error: `OPERATOR_REVOKED [OPERATOR_BLOCKED]: Operador bloqueado administrativamente (${op.motivo || 'Revocado'})`,
                code: 'OPERATOR_BLOCKED'
            };
        }

        if (!op.active) {
            return {
                valid: false,
                role: (op.role === 'admin' || op.role === 'staff') ? op.role : 'other',
                active: false,
                blocked: false,
                error: 'OPERATOR_REVOKED [OPERATOR_INACTIVE]: Operador inactivo',
                code: 'OPERATOR_INACTIVE'
            };
        }

        if (op.role !== 'admin' && op.role !== 'staff') {
            return {
                valid: false,
                role: 'other',
                active: op.active,
                blocked: false,
                error: `OPERATOR_NOT_PERMITTED [INSUFFICIENT_PERMISSIONS]: Rol '${op.role}' sin permisos administrativos`,
                code: 'INSUFFICIENT_PERMISSIONS'
            };
        }

        return {
            valid: true,
            role: op.role,
            active: true,
            blocked: false
        };
    }
}
