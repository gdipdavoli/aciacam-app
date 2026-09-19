import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/app/lib/api-auth';

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

        const access = await requireStaff(req, supabaseAdmin);
        if (access.response) return access.response;

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
