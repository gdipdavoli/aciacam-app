import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/app/lib/supabase/server';

export const runtime = 'nodejs';

// Server-side ONLY environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const path = searchParams.get('path');

        if (!path) {
            return NextResponse.json({ error: "Missing required parameter 'path'" }, { status: 400 });
        }

        // 1. Authenticate user from request header or cookie session
        const authHeader = req.headers.get('Authorization');
        const token = authHeader?.replace('Bearer ', '');

        let user = null;

        if (token) {
            const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
            if (!authError && authUser) {
                user = authUser;
            }
        }

        if (!user) {
            const supabase = await createClientServer();
            const { data: { session }, error: authError } = await supabase.auth.getSession();
            if (!authError && session?.user) {
                user = session.user;
            }
        }

        if (!user) {
            return NextResponse.json({ error: 'No autorizado: Inicie sesión' }, { status: 401 });
        }

        // 2. Verify roles of caller is admin or staff
        const { data: caller, error: roleError } = await supabaseAdmin
            .from('socios')
            .select('rol')
            .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
            .single();

        if (roleError || !caller || (caller.rol !== 'admin' && caller.rol !== 'staff')) {
            return NextResponse.json({ error: 'Prohibido: Se requieren permisos administrativos' }, { status: 403 });
        }

        // 3. Generate signed URL for BUCKET documentos-socios
        const bucket = 'documentos-socios';
        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrl(path, 600); // 10 minutes validation

        if (error) {
            console.error("Storage error generating signed URL:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ signedUrl: data.signedUrl });

    } catch (e: any) {
        console.error("Signed URL API Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
