import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';

// 🔴 CRITICAL: Force Node.js runtime for Service Role compatibility
export const runtime = "nodejs";

// Server-side ONLY environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error("Missing server-side Supabase credentials");
        return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    try {
        // Initialize Supabase with Service Role Key (Bypasses RLS)
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });

        const user = await authenticate(req, supabaseAdmin);
        if (!user) return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const socioId = formData.get('socioId') as string;
        const rawDocType = formData.get('docType') as string;
        const fechaEmision = (formData.get('fechaEmision') as string | null) || null;
        const fechaVencimiento = (formData.get('fechaVencimiento') as string | null) || null;
        const numeroTramite = (formData.get('numeroTramite') as string | null) || null;

        if (!file || !socioId || !rawDocType) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Canonicalize document type
        const rawLower = rawDocType.toLowerCase().trim();
        const docType = (rawLower === 'declaracionjurada' || rawLower === 'declaracion_jurada' || (rawLower.includes('declaracion') && rawLower.includes('jurada')))
            ? 'declaracion_jurada'
            : rawDocType;

        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(socioId) || !/^[a-zA-Z0-9_-]+$/.test(docType)) {
            return NextResponse.json({ error: 'Documento inválido' }, { status: 400 });
        }
        if (!await hasStaffRole(user, supabaseAdmin)) {
            const { data: owner, error } = await supabaseAdmin.from('socios').select('auth_user_id').eq('id', socioId).maybeSingle();
            if (error) throw error;
            if (!owner || owner.auth_user_id !== user.id) {
                return NextResponse.json({ error: 'No podés modificar documentos de otro socio' }, { status: 403 });
            }
        }
        // Basic validation
        if (file.size > 10 * 1024 * 1024) { // 10MB
            return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
        }

        const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const timestamp = Date.now();
        const path = `${socioId}/${docType}/${timestamp}-${safeFilename}`;
        const bucket = 'documentos-socios';

        const buffer = Buffer.from(await file.arrayBuffer());

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from(bucket)
            .upload(path, buffer, {
                contentType: file.type,
                upsert: false
            });

        if (uploadError) {
            console.error("Supabase Storage Upload Error:", uploadError);
            return NextResponse.json({ error: uploadError.message }, { status: 500 });
        }

        // 2. Manage versioning and insert new document record
        const { data: existingDoc } = await supabaseAdmin
            .from('documentos_socio')
            .select('id, version')
            .eq('socio_id', socioId)
            .eq('tipo', docType)
            .eq('is_current', true)
            .maybeSingle();

        if (existingDoc) {
            await supabaseAdmin
                .from('documentos_socio')
                .update({ is_current: false, updated_at: new Date().toISOString() })
                .eq('id', existingDoc.id);
        }

        const newVersion = existingDoc ? (existingDoc.version || 1) + 1 : 1;
        const supersedesId = existingDoc ? existingDoc.id : null;

        const docPayload: any = {
            socio_id: socioId,
            tipo: docType,
            archivo_path: path,
            verificacion_estado: 'pendiente',
            verificado_at: null,
            verificado_por: null,
            is_current: true,
            version: newVersion,
            supersedes_document_id: supersedesId
        };
        if (fechaEmision) docPayload.fecha_emision = fechaEmision;
        if (fechaVencimiento) docPayload.fecha_vencimiento = fechaVencimiento;

        const { error: dbError } = await supabaseAdmin
            .from('documentos_socio')
            .insert(docPayload);

        if (dbError) {
            console.error("Supabase DB Insert Error:", dbError);
            return NextResponse.json({ error: "Upload successful but DB insert failed: " + dbError.message }, { status: 500 });
        }

        // 3. If reprocann, persist trámite number and dates to socios table
        if (docType === 'reprocann') {
            const socioUpdates: any = {};
            if (numeroTramite && numeroTramite.trim()) socioUpdates.reprocann_num_tramite = numeroTramite.trim();
            if (fechaVencimiento && fechaVencimiento.trim()) socioUpdates.reprocann_fecha_vencimiento = fechaVencimiento.trim();
            if (fechaEmision && fechaEmision.trim()) socioUpdates.reprocann_fecha_alta = fechaEmision.trim();
            if (Object.keys(socioUpdates).length > 0) {
                const { error: sUpdateErr } = await supabaseAdmin
                    .from('socios')
                    .update(socioUpdates)
                    .eq('id', socioId);
                if (sUpdateErr) {
                    console.error("Error updating socio reprocann fields:", sUpdateErr);
                }
            }
        }

        return NextResponse.json({ path: uploadData.path, success: true }, { status: 200 });

    } catch (error: any) {
        console.error("Upload API Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
