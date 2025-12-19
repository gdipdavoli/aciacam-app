import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const socioId = formData.get('socioId') as string;
        const docType = formData.get('docType') as string;

        if (!file || !socioId || !docType) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Basic validation
        if (file.size > 10 * 1024 * 1024) { // 10MB
            return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
        }

        // Initialize Supabase with Service Role Key (Bypasses RLS)
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });

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

        // 2. UPSERT in Database (documentos_socio)
        // We use onConflict on (socio_id, tipo)
        // We do NOT update 'estado' as it is deprecated.
        const { error: dbError } = await supabaseAdmin
            .from('documentos_socio')
            .upsert({
                socio_id: socioId,
                tipo: docType,
                archivo_path: path,
                // verificacion_estado: 'pendiente' // OPTIONAL: Do we want to reset verification on new upload? 
                // Let's assume YES, strict mode: New Document -> New Verification needed.
                verificacion_estado: 'pendiente',
                verificado_at: null,
                verificado_por: null
            }, {
                onConflict: 'socio_id, tipo'
            });

        if (dbError) {
            console.error("Supabase DB Insert Error:", dbError);
            // Optional: Rollback storage if DB fails? For now, just report error.
            return NextResponse.json({ error: "Upload successful but DB insert failed: " + dbError.message }, { status: 500 });
        }

        return NextResponse.json({ path: uploadData.path, success: true }, { status: 200 });

    } catch (error: any) {
        console.error("Upload API Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
