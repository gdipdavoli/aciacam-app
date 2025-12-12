import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 🔴 CRITICAL: Force Node.js runtime for Service Role compatibility
export const runtime = "nodejs";

// Server-side ONLY environment variables
const SUPABASE_URL = process.env.SUPABASE_URL!;
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

        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .upload(path, buffer, {
                contentType: file.type,
                upsert: false
            });

        if (error) {
            console.error("Supabase Storage Upload Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ path: data.path }, { status: 200 });

    } catch (error: any) {
        console.error("Upload API Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
