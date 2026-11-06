import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';

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

        const authResult = await authenticate(req, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) {
            return NextResponse.json({ error: "Iniciá sesión para continuar" }, { status: 401 });
        }

        // Sanitize path: disallow directory traversal
        if (path.includes('..') || path.includes('\\')) {
            return NextResponse.json({ error: "Ruta de documento inválida" }, { status: 400 });
        }

        const isStaff = await hasStaffRole(caller, supabaseAdmin);

        // Verify that the document exists in public.documentos_socio
        const { data: docRecords } = await supabaseAdmin
            .from('documentos_socio')
            .select('id, socio_id')
            .eq('archivo_path', path);

        if (!docRecords || docRecords.length === 0) {
            return NextResponse.json({ error: "Documento no registrado en la base de datos" }, { status: 404 });
        }

        // If not staff, enforce strict database ownership
        if (!isStaff) {
            const { data: callerSocio } = await supabaseAdmin
                .from('socios')
                .select('id')
                .eq('auth_user_id', caller.id)
                .maybeSingle();

            const isOwner = Boolean(callerSocio && docRecords.some(d => d.socio_id === callerSocio.id));

            if (!isOwner) {
                return NextResponse.json({ error: "No tenés permisos para visualizar este documento" }, { status: 403 });
            }
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

        return NextResponse.json({ signedUrl: data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } });

    } catch (e: any) {
        console.error("Signed URL API Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
