import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/app/lib/api-auth';
import { NextResponse } from 'next/server';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
function escaped(value: any): any {
    if (typeof value === 'string') return escapeHtml(value);
    if (Array.isArray(value)) return value.map(escaped);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, escaped(item)]));
    return value;
}

export async function POST(req: Request) {
    try {
        const access = await requireStaff(req, admin);
        if (access.response) return access.response;
        const { cierreId } = await req.json();
        if (typeof cierreId !== 'string' || !/^[0-9a-f-]{36}$/i.test(cierreId)) return NextResponse.json({ error: 'Cierre inválido' }, { status: 400 });
        const { data: cierre, error: cierreError } = await admin.from('cierres_mensuales').select('*').eq('id', cierreId).maybeSingle();
        if (cierreError) return NextResponse.json({ error: 'No se pudo consultar el cierre' }, { status: 500 });
        if (!cierre) return NextResponse.json({ error: 'Cierre no encontrado' }, { status: 404 });
        if (cierre.estado !== 'emitido') return NextResponse.json({ error: 'No se puede enviar una constancia anulada' }, { status: 409 });
        const { data: destinatario, error: socioError } = await admin.from('socios').select('email, nombre, apellido').eq('id', cierre.socio_id).single();
        if (socioError || !destinatario?.email) return NextResponse.json({ error: 'El socio no tiene un correo disponible' }, { status: 400 });
        const to = destinatario.email;
        const socioName = escapeHtml(destinatario.nombre + ' ' + destinatario.apellido);
        const periodo = cierre.periodo;
        const datosCierre = escaped({ datos: cierre.datos, numeroConstancia: cierre.numero_constancia, hashSha256: cierre.hash_sha256 });
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return NextResponse.json({ success: false, error: 'El servicio de correo no está configurado. La constancia no fue enviada.' }, { status: 503 });

        const socio = datosCierre.datos?.socio || {};
        const dispensas = datosCierre.datos?.dispensas || [];
        const aportes = datosCierre.datos?.aportes || [];
        
        let dispensasRows = '';
        dispensas.forEach((d: any) => {
            const itemsText = d.items.map((i: any) => `${i.cantidad}x ${i.productoNombre}`).join(', ');
            const dateStr = new Date(d.fecha).toLocaleDateString('es-AR');
            dispensasRows += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${dateStr}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${d.pedidoId.substring(0, 8)}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${itemsText}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${d.operador || 'Sistema'}</td>
                </tr>
            `;
        });

        let aportesRows = '';
        let totalAportes = 0;
        aportes.forEach((a: any) => {
            const dateStr = new Date(a.fecha).toLocaleDateString('es-AR');
            const formatMedio = a.medioDePago === 'transferencia_galicia' ? 'Transferencia Banco Galicia' : 
                               a.medioDePago === 'mercadopago' ? 'MercadoPago' : 
                               a.medioDePago === 'efectivo' ? 'Efectivo' : a.medioDePago;
            totalAportes += a.monto;
            
            aportesRows += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${dateStr}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${a.concepto}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd; text-transform: capitalize;">${formatMedio} ${a.referencia ? `(Ref: ${a.referencia})` : ''}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; font-weight: bold;">$${a.monto.toLocaleString('es-AR')}</td>
                </tr>
            `;
        });

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                <!-- Header -->
                <div style="background-color: #0F3822; color: #fff; padding: 20px; text-align: center;">
                    <h1 style="margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 0.5px;">ACIACAM</h1>
                    <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.9;">Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal</p>
                    <p style="margin: 2px 0 0 0; font-size: 11px; opacity: 0.8;">Personería Jurídica N° 119/2023 | CUIT: 30-71825047-8</p>
                </div>
                
                <!-- Content Body -->
                <div style="padding: 24px; background-color: #ffffff;">
                    <h2 style="color: #0F3822; font-size: 16px; border-bottom: 2px solid #0F3822; padding-bottom: 8px; margin-top: 0;">Constancia Mensual de Aportes y Dispensas</h2>
                    <p style="font-size: 13px;">Estimado/a <strong>${socioName}</strong>,</p>
                    <p style="font-size: 13px;">Le hacemos llegar la constancia registrada de su legajo correspondiente al período mensual <strong>${periodo}</strong>.</p>
                    
                    <!-- Socio Info Box -->
                    <div style="background-color: #f7f9f8; border: 1px solid #e8edea; border-radius: 6px; padding: 15px; margin: 20px 0; font-size: 12px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 3px 0; color: #666; width: 100px;">Asociado:</td>
                                <td style="padding: 3px 0; font-weight: bold;">${socio.nombre} ${socio.apellido}</td>
                            </tr>
                            <tr>
                                <td style="padding: 3px 0; color: #666;">DNI:</td>
                                <td style="padding: 3px 0; font-weight: bold;">${socio.dni || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 3px 0; color: #666;">REPROCANN:</td>
                                <td style="padding: 3px 0; font-weight: bold;">${socio.reprocann?.numeroTramite || 'N/A'} (Estado: ${socio.reprocann?.estado || 'pendiente'})</td>
                            </tr>
                            <tr>
                                <td style="padding: 3px 0; color: #666;">Diagnóstico:</td>
                                <td style="padding: 3px 0; font-weight: bold;">${socio.diagnosticoPrincipal || 'N/A'}</td>
                            </tr>
                        </table>
                    </div>

                    <!-- Dispensas Table -->
                    <h3 style="color: #0F3822; font-size: 14px; margin-top: 25px; margin-bottom: 10px;">Detalle de Dispensas</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #f2f2f2; text-align: left; font-weight: bold;">
                                <th style="padding: 10px; border-bottom: 2px solid #ddd;">Fecha</th>
                                <th style="padding: 10px; border-bottom: 2px solid #ddd;">Remito ID</th>
                                <th style="padding: 10px; border-bottom: 2px solid #ddd;">Detalle</th>
                                <th style="padding: 10px; border-bottom: 2px solid #ddd;">Responsable</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${dispensasRows || '<tr><td colspan="4" style="padding: 15px; text-align: center; color: #888; font-style: italic;">No se registraron dispensas en este período.</td></tr>'}
                        </tbody>
                    </table>

                    <!-- Aportes Table -->
                    <h3 style="color: #0F3822; font-size: 14px; margin-top: 25px; margin-bottom: 10px;">Detalle de Aportes Económicos</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 15px;">
                        <thead>
                            <tr style="background-color: #f2f2f2; text-align: left; font-weight: bold;">
                                <th style="padding: 10px; border-bottom: 2px solid #ddd;">Fecha</th>
                                <th style="padding: 10px; border-bottom: 2px solid #ddd;">Concepto</th>
                                <th style="padding: 10px; border-bottom: 2px solid #ddd;">Medio de Pago</th>
                                <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align: right;">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${aportesRows || '<tr><td colspan="4" style="padding: 15px; text-align: center; color: #888; font-style: italic;">No se registraron aportes económicos en este período.</td></tr>'}
                        </tbody>
                    </table>
                    
                    <div style="text-align: right; font-size: 14px; font-weight: bold; color: #0F3822; margin-bottom: 25px;">
                        Total Aportado: $${totalAportes.toLocaleString('es-AR')}
                    </div>

                    <!-- Legal Frame -->
                    <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; font-size: 10px; color: #777; text-align: justify; line-height: 1.4; margin-bottom: 15px;">
                        ${datosCierre.datos?.pie_legal || 'Los importes consignados corresponden exclusivamente a aportes voluntarios destinados al sostenimiento del programa de cultivo solidario desarrollado por la Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal (ACIACAM), en cumplimiento de su Estatuto Social, de la Ley Nacional N° 27.350, su Decreto Reglamentario N° 883/2020, la Resolución MS N° 800/2021 y demás normativa aplicable. Dichos aportes no constituyen precio de venta ni contraprestación comercial por los productos dispensados.'}
                    </div>

                    <div style="font-size: 9px; color: #999; text-align: center; border-top: 1px dashed #e0e0e0; padding-top: 10px;">
                        Constancia N°: ${datosCierre.numeroConstancia || 'CM-XXXX-XXXXXX'} | Firma Criptográfica: ${datosCierre.hashSha256 || 'N/A'}
                    </div>
                </div>
            </div>
        `;

        // Production: send using Resend API via raw HTTP Fetch
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                from: 'ACIACAM <no-reply@aciacam.org>',
                to: [to],
                subject: `Constancia Mensual de Aportes y Dispensas - Período ${periodo}`,
                html: htmlContent
            })
        });

        const resData = await response.json();
        if (!response.ok) {
            console.error("Resend API failed:", resData);
            return NextResponse.json({ success: false, error: resData.message || 'Resend error' }, { status: response.status });
        }

        if (!resData.id) return NextResponse.json({ success: false, error: 'El proveedor no confirmó el envío' }, { status: 502 });
        return NextResponse.json({ success: true, resendId: resData.id, to });
    } catch (e: any) {
        console.error("send-email route error:", e);
        return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
    }
}
