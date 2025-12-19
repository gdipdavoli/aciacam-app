
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const productId = formData.get('productId') as string;

        if (!file || !productId) {
            return NextResponse.json({ error: 'Falta archivo o ID de producto' }, { status: 400 });
        }

        // Validation
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json({ error: 'Tipo de archivo no permitido. Usar: JPG, PNG, WEBP' }, { status: 400 });
        }

        if (file.size > 5 * 1024 * 1024) { // 5MB
            return NextResponse.json({ error: 'Archivo muy grande (Max 5MB)' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = Date.now();
        // Sanitize filename
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const path = `${productId}/${timestamp}-${safeName}`;

        const { data, error } = await supabaseAdmin
            .storage
            .from('products-images')
            .upload(path, buffer, {
                contentType: file.type,
                upsert: true
            });

        if (error) {
            console.error("Storage missing?", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Construct Public URL
        const { data: { publicUrl } } = supabaseAdmin
            .storage
            .from('products-images')
            .getPublicUrl(path);

        return NextResponse.json({ path: publicUrl });

    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
