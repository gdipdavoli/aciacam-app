import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/app/lib/supabase/server';
import { NextResponse } from 'next/server';
import { UserRole } from '@/types';

// Server-Role Supabase Client (Admin Access)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

/**
 * Interface para validar el rol del usuario solicitante
 */
interface CallerInfo {
    rol: UserRole;
}

export async function GET(request: Request) {
    try {
        // 1. Obtener token del header Authorization
        const authHeader = request.headers.get('Authorization');
        const token = authHeader?.replace('Bearer ', '');

        let user = null;

        if (token) {
            // Validar token con el cliente de servicio para robustez
            const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
            if (!authError && authUser) {
                user = authUser;
            }
        }

        // 2. Si no hay token, o falló, buscar sesión por cookie usando el cliente de servidor
        if (!user) {
            const supabase = await createClientServer();
            const { data: { session }, error: authError } = await supabase.auth.getSession();
            if (!authError && session?.user) {
                user = session.user;
            }
        }

        if (!user) {
            return NextResponse.json({ error: 'No autorizado: Inicie sesión (Token faltante o inválido)' }, { status: 401 });
        }

        // 3. Verificar Rol de Administrador en la tabla de socios (revisa ambos campos)
        const { data: caller, error: roleError } = await supabaseAdmin
            .from('socios')
            .select('rol')
            .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
            .single();

        const callerInfo = caller as CallerInfo | null;

        if (roleError || !callerInfo || (callerInfo.rol !== 'admin' && callerInfo.rol !== 'staff')) {
            return NextResponse.json(
                { error: 'Prohibido: Se requieren permisos de administrador' }, 
                { status: 403 }
            );
        }

        // 4. Procesar consulta usando supabaseAdmin para evitar cualquier restricción de RLS
        const { searchParams } = new URL(request.url);
        const roleFilter = searchParams.get('role');

        let query = supabaseAdmin
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
