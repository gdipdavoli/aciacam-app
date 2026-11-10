import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticate, hasStaffRole } from '@/app/lib/api-auth';
import { 
    extractTextFromPdfBuffer, 
    extractDataFromDocumentText, 
    validateIdentityMatch,
    UnifiedDocumentExtraction 
} from '@/app/lib/ocr-contract';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export async function POST(req: NextRequest) {
    try {
        // 1. Autenticación y Autorización Staff / Admin
        const authResult = await authenticate(req, supabaseAdmin);
        const caller = (authResult && typeof authResult === 'object' && 'user' in authResult)
            ? (authResult as any).user
            : authResult;

        if (!caller) {
            return NextResponse.json({ error: 'Iniciá sesión para continuar' }, { status: 401 });
        }

        const isStaff = await hasStaffRole(caller, supabaseAdmin);
        if (!isStaff) {
            return NextResponse.json({ error: 'Solo el personal administrativo puede procesar extracción documental' }, { status: 403 });
        }

        // 2. Parsear FormData
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const targetSocioDni = formData.get('socioDni') as string | null;

        if (!file) {
            return NextResponse.json({ error: 'No se suministró ningún archivo para procesar' }, { status: 400 });
        }

        // Validación de tamaño (máximo 15MB)
        if (file.size > 15 * 1024 * 1024) {
            return NextResponse.json({ error: 'El archivo excede el límite permitido de 15MB' }, { status: 400 });
        }

        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        let extraction: UnifiedDocumentExtraction;

        // 3. Evaluar integración con Agent Core si estuviera activo
        const agentCoreEnabled = process.env.AGENT_CORE_ENABLED === 'true';

        if (agentCoreEnabled) {
            // Placeholder adapter hacia Agent Core (cuando se autorice su activación de solo lectura)
            // Por directiva arquitectónica, actualmente Agent Core permanece con kill-switch activo
        }

        // 4. Extracción Local de Capa de Texto Digital (Optimización local server-side)
        if (isPdf) {
            const buffer = Buffer.from(await file.arrayBuffer());
            const textContent = extractTextFromPdfBuffer(buffer);
            extraction = extractDataFromDocumentText(textContent, file.name);
        } else {
            // Archivo de imagen (JPEG/PNG) sin motor de visión externo activo
            extraction = {
                documentType: 'desconocido',
                confidence: { overall: 0, fields: {} },
                isLegible: false,
                extractionSource: 'local_text_layer',
                sourceDescription: 'Archivo de imagen rasterizada (requiere entrada manual o visión multimodal)',
                warnings: [
                    'El archivo es una imagen o documento sin capa de texto digital embebida.',
                    'Por favor complete o verifique los datos del socio manualmente.'
                ],
                errors: [],
                humanValidated: false
            };
        }

        // 5. Cotejo de Identidad si se suministró DNI objetivo del socio
        let identityCheck: any = null;
        if (targetSocioDni && extraction.dni) {
            const check = validateIdentityMatch(extraction.dni, targetSocioDni);
            identityCheck = {
                matches: check.match,
                docDni: check.normalizedDoc,
                socioDni: check.normalizedPartner,
                warning: !check.match ? 'Discrepancia detectada: el DNI del documento no coincide con el DNI del socio seleccionado.' : null
            };
            if (!check.match) {
                extraction.warnings.push(`DISCREPANCIA DE IDENTIDAD: DNI del documento (${check.normalizedDoc}) difiere del socio (${check.normalizedPartner})`);
            }
        }

        return NextResponse.json({
            success: true,
            extraction,
            identityCheck
        }, {
            headers: { 'Cache-Control': 'no-store' }
        });

    } catch (e: any) {
        console.error('Error en extracción documental:', e);
        return NextResponse.json({ 
            error: e.message || 'Error al procesar la extracción documental' 
        }, { status: 500 });
    }
}

