import { createClientServer } from '@/app/lib/supabase/server';
import { NextResponse } from 'next/server';
import { UserRole } from '@/types';

/**
 * Interface para validar el rol del usuario solicitante
 */
interface CallerInfo {
    rol: UserRole;
}

export async function GET(request: Request) {
    try {
        // 1. Crear cliente de servidor (valida cookies automáticamente)
        const supabase = await createClientServer();
        
        // 2. Obtener sesión actual
        const { data: { session }, error: authError } = await supabase.auth.getSession();

        if (authError || !session) {
            return NextResponse.json({ error: 'No autorizado: Inicie sesión' }, { status: 401 });
        }

        // 3. Verificar Rol de Administrador en la tabla de socios (revisa ambos campos)
        const { data: caller, error: roleError } = await supabase
            .from('socios')
            .select('rol')
            .or(`auth_user_id.eq.${session.user.id},user_id.eq.${session.user.id}`)
            .single();

        const callerInfo = caller as CallerInfo | null;

        if (roleError || !callerInfo || (callerInfo.rol !== 'admin' && callerInfo.rol !== 'staff')) {
            return NextResponse.json(
                { error: 'Prohibido: Se requieren permisos de administrador' }, 
                { status: 403 }
            );
        }

        // 4. Procesar consulta (si llega aquí, está autorizado)
        const { searchParams } = new URL(request.url);
        const roleFilter = searchParams.get('role');

        let query = supabase
            .from('socios_with_auth')
            .select('*')
            .order('created_at', { ascending: false });

        if (roleFilter) {
            query = query.eq('rol', roleFilter);
        }

        const { data: socios, error: queryError } = await query;

        if (queryError) {
            console.error('API queryError:', queryError);
            return NextResponse.json({ error: `Error al consultar datos: ${queryError.message}`, details: queryError }, { status: 500 });
        }

        // 5. Retornar datos
        return NextResponse.json(socios);

    } catch (e: any) {
        console.error('API catch error:', e);
        return NextResponse.json({ error: `Error interno del servidor: ${e.message}` }, { status: 500 });
    }
}
