import { NextRequest, NextResponse } from 'next/server';
import { createClientServer } from '@/app/lib/supabase/server';
import { AgendaService } from '@/app/lib/agenda/agenda-service';
import { createClient } from '@supabase/supabase-js';

// Admin Client to bypass RLS for role checks and admin operations
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
    const supabase = await createClientServer();

    // 1. Validate User Identity (using Token)
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    let user = null;
    if (token) {
        const { data } = await supabase.auth.getUser(token);
        user = data.user;
    } else {
        const { data } = await supabase.auth.getUser();
        user = data.user;
    }

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 2. Check Role using ADMIN Client (Bypass RLS)
    const { data: socio, error: socioError } = await supabaseAdmin
        .from('socios')
        .select('rol')
        .eq('user_id', user.id)
        .single();

    if (socioError || !socio || (socio.rol !== 'admin' && socio.rol !== 'staff')) {
        console.error("Agenda API: Role Error", socioError);
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Perform Operations using ADMIN Client (Agenda config is high privilege)
    const service = new AgendaService(supabaseAdmin);
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    try {
        if (action === 'get_slots') {
            const month = url.searchParams.get('month'); // YYYY-MM
            if (!month) return NextResponse.json({ error: 'Month required' }, { status: 400 });
            const slots = await service.getSlotsForMonth(month);
            return NextResponse.json({ slots });
        }

        // Default: Get Configs
        const configs = await service.getConfigs();
        return NextResponse.json({ configs });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const supabase = await createClientServer();

    // Auth with Bearer Token
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    let user = null;
    if (token) {
        const { data } = await supabase.auth.getUser(token);
        user = data.user;
    } else {
        const { data } = await supabase.auth.getUser();
        user = data.user;
    }

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Admin Check
    const { data: socio } = await supabaseAdmin.from('socios').select('rol').eq('user_id', user.id).single();
    if (!socio || (socio.rol !== 'admin' && socio.rol !== 'staff')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const service = new AgendaService(supabaseAdmin);
    const body = await req.json();

    try {
        if (body.action === 'UPSERT_RULE') {
            const config = await service.upsertConfig(body.data);
            return NextResponse.json({ config });
        }

        if (body.action === 'GENERATE') {
            const count = await service.generateSlotsForMonth(body.month);
            return NextResponse.json({ count });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const supabase = await createClientServer();

    // Auth
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    let user = null;
    if (token) {
        const { data } = await supabase.auth.getUser(token);
        user = data.user;
    } else {
        const { data } = await supabase.auth.getUser();
        user = data.user;
    }

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: socio } = await supabaseAdmin.from('socios').select('rol').eq('user_id', user.id).single();
    if (!socio || (socio.rol !== 'admin' && socio.rol !== 'staff')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const service = new AgendaService(supabaseAdmin);
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const type = url.searchParams.get('type'); // 'rule' or 'slot'

    if (!id || !type) return NextResponse.json({ error: 'Missing id or type' }, { status: 400 });

    try {
        if (type === 'rule') {
            await service.deleteConfig(id);
        } else if (type === 'slot') {
            await service.deleteSlot(id);
        } else {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
