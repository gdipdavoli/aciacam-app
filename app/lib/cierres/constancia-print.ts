export interface ConstanciaSnapshotInput {
    periodo: string;
    numeroConstancia: string;
    fechaGeneracion: string;
    hashSha256: string;
    estado: 'emitido' | 'anulado' | string;
    isEmitted: boolean;
    motivoAnulacion?: string | null;
    fechaAnulacion?: string | null;
    datos: {
        socio?: {
            nombre?: string;
            apellido?: string;
            dni?: string;
            numeroSocio?: string;
            diagnosticoPrincipal?: string;
            reprocann?: {
                numeroTramite?: string;
                vencimiento?: string;
                fechaVencimiento?: string;
            };
        };
        dispensas?: Array<{
            pedidoId?: string;
            fecha?: string;
            items?: Array<{ cantidad?: number; productoNombre?: string }>;
            operador?: string;
        }>;
        aportes?: Array<{
            fecha?: string;
            concepto?: string;
            medioDePago?: string;
            referencia?: string;
            monto?: number;
        }>;
        pie_legal?: string;
    } | null;
}

export function selectPreferredCierre<
    T extends { estado?: string | null; fecha_generacion?: string | null; fechaGeneracion?: string | null }
>(rows: T[] | null | undefined): T | null {
    if (!rows || rows.length === 0) return null;
    const sorted = [...rows].sort((a, b) => {
        const da = new Date(a.fecha_generacion || a.fechaGeneracion || 0).getTime();
        const db = new Date(b.fecha_generacion || b.fechaGeneracion || 0).getTime();
        return db - da;
    });
    const emitted = sorted.find(r => r.estado === 'emitido');
    return emitted || sorted[0];
}

function escapeHtml(value: unknown): string {
    const str = value === null || value === undefined ? '' : String(value);
    return str.replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
    ));
}

function formatDateAr(raw?: string | null, fallback = 'N/A'): string {
    if (!raw) return fallback;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
        const [y, m, d] = raw.trim().split('-');
        return `${d}/${m}/${y}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed.toLocaleDateString('es-AR');
}

function formatDateTimeAr(raw?: string | null): string {
    if (!raw) return 'N/A';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.toLocaleString('es-AR');
}

function formatMedioPago(raw?: string | null): string {
    if (!raw) return 'N/A';
    if (raw === 'transferencia_galicia') return 'Galicia Transf.';
    if (raw === 'mercadopago') return 'MercadoPago';
    if (raw === 'efectivo') return 'Efectivo';
    return raw;
}

function formatCurrencyAr(amount: number): string {
    const isNeg = amount < 0;
    return `${isNeg ? '-' : ''}$${Math.abs(amount).toLocaleString('es-AR')}`;
}

export function buildConstanciaPrintHtml(input: ConstanciaSnapshotInput): string {
    const datos = input.datos || {};
    const socio = datos.socio || {};
    const dispensas = Array.isArray(datos.dispensas) ? datos.dispensas : [];
    const aportes = Array.isArray(datos.aportes) ? datos.aportes : [];
    const isAnulado = input.estado === 'anulado';

    const statusBanner = !input.isEmitted
        ? `<div class="status-banner preview">VISTA PREVIA NO EMITIDA — BORRADOR SIN CONGELAR NI VALIDEZ INSTITUCIONAL</div>`
        : isAnulado
            ? `<div class="status-banner annulled">DOCUMENTO ANULADO</div>`
            : `<div class="status-banner emitted">CONSTANCIA OFICIAL EMITIDA</div>`;

    const dispensasRows = dispensas.length === 0
        ? `<tr><td colspan="4" class="empty-cell">No se registraron dispensas en este período.</td></tr>`
        : dispensas.map(disp => {
            const itemsHtml = (disp.items || [])
                .map(it => `<div>${escapeHtml(it.cantidad ?? 0)}x ${escapeHtml(it.productoNombre || 'Producto')}</div>`)
                .join('') || '<div>—</div>';
            const remito = disp.pedidoId ? disp.pedidoId.substring(0, 8) : '—';
            return `
                <tr>
                    <td>${escapeHtml(formatDateAr(disp.fecha))}</td>
                    <td class="mono">${escapeHtml(remito)}</td>
                    <td>${itemsHtml}</td>
                    <td>${escapeHtml(disp.operador || 'Sistema')}</td>
                </tr>
            `;
        }).join('');

    let totalAportado = 0;
    const aportesRows = aportes.length === 0
        ? `<tr><td colspan="4" class="empty-cell">No se registraron aportes económicos en este período.</td></tr>`
        : aportes.map(apo => {
            const monto = typeof apo.monto === 'number' ? apo.monto : 0;
            totalAportado += monto;
            const refHtml = apo.referencia ? ` (Ref: ${escapeHtml(apo.referencia)})` : '';
            return `
                <tr>
                    <td>${escapeHtml(formatDateAr(apo.fecha))}</td>
                    <td>${escapeHtml(apo.concepto || 'Aporte')}</td>
                    <td class="capitalize">${escapeHtml(formatMedioPago(apo.medioDePago))}${refHtml}</td>
                    <td class="num ${monto < 0 ? 'neg' : ''}">${escapeHtml(formatCurrencyAr(monto))}</td>
                </tr>
            `;
        }).join('');

    const annulBox = isAnulado
        ? `<div class="annul-box">
             <strong>MOTIVO DE ANULACIÓN:</strong> "${escapeHtml(input.motivoAnulacion || 'Sin motivo especificado')}"
             — Anulado el ${escapeHtml(formatDateTimeAr(input.fechaAnulacion))}
           </div>`
        : '';

    const reprocannVenc = socio.reprocann?.vencimiento || socio.reprocann?.fechaVencimiento;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Constancia ACIACAM - ${escapeHtml(input.periodo)} - ${escapeHtml(input.numeroConstancia)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 14mm 15mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #111827;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.45;
  }
  .doc-container {
    width: 100%;
    max-width: 180mm;
    margin: 0 auto;
  }
  .header {
    text-align: center;
    padding-bottom: 12px;
    border-bottom: 1.5px dashed #111827;
  }
  .header h1 {
    margin: 0;
    font-size: 20px;
    letter-spacing: 0.5px;
    color: #0F3822;
  }
  .header .subtitle {
    margin: 3px 0 0 0;
    font-size: 11px;
    color: #374151;
  }
  .meta-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9px;
    margin-top: 8px;
  }
  .meta-table td {
    padding: 2px 0;
  }
  .title-block {
    text-align: center;
    padding: 14px 0 10px 0;
  }
  .title-block h2 {
    margin: 0;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .title-block p {
    margin: 4px 0 0 0;
    font-size: 11px;
  }
  .status-banner {
    display: inline-block;
    margin-top: 8px;
    padding: 4px 12px;
    font-size: 10px;
    font-weight: bold;
    border-radius: 4px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .status-banner.emitted {
    border: 1.5px solid #0F3822;
    color: #0F3822;
    background: #ECFDF5;
  }
  .status-banner.preview {
    border: 1.5px solid #92400E;
    color: #92400E;
    background: #FEF3C7;
  }
  .status-banner.annulled {
    border: 2px solid #B91C1C;
    color: #B91C1C;
    background: #FEE2E2;
  }
  .socio-box {
    border: 1px solid #111827;
    padding: 10px 12px;
    margin-top: 4px;
    break-inside: avoid;
  }
  .socio-box table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
  }
  .socio-box td {
    padding: 2.5px 4px;
    vertical-align: top;
  }
  .section {
    margin-top: 16px;
  }
  .section h3 {
    margin: 0 0 6px 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #0F3822;
  }
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  table.data-table thead {
    display: table-header-group;
  }
  table.data-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  table.data-table th {
    border-bottom: 1.5px solid #111827;
    padding: 5px 6px;
    text-align: left;
    font-weight: bold;
    background: #F3F4F6;
  }
  table.data-table th.num,
  table.data-table td.num {
    text-align: right;
  }
  table.data-table td {
    border-bottom: 1px solid #D1D5DB;
    padding: 5px 6px;
    vertical-align: top;
  }
  table.data-table td.empty-cell {
    padding: 10px;
    text-align: center;
    font-style: italic;
    color: #6B7280;
  }
  .mono {
    font-family: monospace;
  }
  .capitalize {
    text-transform: capitalize;
  }
  .num {
    font-weight: bold;
    white-space: nowrap;
  }
  .num.neg {
    color: #B91C1C;
  }
  .total-row {
    text-align: right;
    font-size: 11.5px;
    font-weight: bold;
    margin-top: 8px;
    padding-top: 4px;
  }
  .legal-block {
    margin-top: 22px;
    padding-top: 12px;
    border-top: 1px solid #111827;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .legal-text {
    font-size: 9px;
    text-align: justify;
    line-height: 1.4;
    margin: 0;
    color: #374151;
  }
  .annul-box {
    border: 1.5px solid #B91C1C;
    background: #FEF2F2;
    color: #991B1B;
    padding: 8px 10px;
    margin-top: 12px;
    font-size: 10px;
  }
  .signatures {
    width: 100%;
    margin-top: 40px;
    font-size: 9px;
    border-collapse: collapse;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .signatures td {
    text-align: center;
    vertical-align: bottom;
  }
  .sig-line {
    border-bottom: 1px solid #111827;
    height: 28px;
    margin: 0 18px;
  }
  .sig-label {
    display: block;
    margin-top: 4px;
    font-weight: bold;
    text-transform: uppercase;
    color: #374151;
  }
  .doc-footer {
    margin-top: 28px;
    padding-top: 8px;
    border-top: 1px dashed #6B7280;
    text-align: center;
    font-size: 8.5px;
    color: #4B5563;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .hash-line {
    font-family: monospace;
    word-break: break-all;
    margin-top: 2px;
  }
</style>
</head>
<body>
  <div class="doc-container">
    <div class="header">
      <h1>ACIACAM</h1>
      <p class="subtitle">Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal</p>
      <table class="meta-table">
        <tbody>
          <tr>
            <td style="text-align:left;"><strong>Personería Jurídica:</strong> N° 119/2023 (DPJ San Luis)</td>
            <td style="text-align:right;"><strong>CUIT:</strong> 30-71825047-8</td>
          </tr>
          <tr>
            <td style="text-align:left;"><strong>Expte. Salud/ONG:</strong> Expte. DI-2023-162-APN-DNRIEI#MS</td>
            <td style="text-align:right;"><strong>Nº Trámite REPROCANN:</strong> Trámite Nº 340155</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="title-block">
      <h2>Constancia Mensual de Aportes y Dispensas</h2>
      <p>Período: <strong>${escapeHtml(input.periodo)}</strong></p>
      ${statusBanner}
    </div>

    <div class="socio-box">
      <table>
        <tbody>
          <tr>
            <td style="width:18%;"><strong>Asociado:</strong></td>
            <td style="width:37%;">${escapeHtml(`${socio.nombre || ''} ${socio.apellido || ''}`.trim() || 'N/A')}</td>
            <td style="width:16%;"><strong>DNI:</strong></td>
            <td style="width:29%;">${escapeHtml(socio.dni || 'N/A')}</td>
          </tr>
          <tr>
            <td><strong>Nº Socio:</strong></td>
            <td>${escapeHtml(socio.numeroSocio || 'N/A')}</td>
            <td><strong>Patología:</strong></td>
            <td>${escapeHtml(socio.diagnosticoPrincipal || 'N/A')}</td>
          </tr>
          <tr>
            <td><strong>REPROCANN N°:</strong></td>
            <td>${escapeHtml(socio.reprocann?.numeroTramite || 'N/A')}</td>
            <td><strong>Vencimiento:</strong></td>
            <td>${escapeHtml(formatDateAr(reprocannVenc))}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <h3>Detalle de Dispensas de Fitopreparados</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:16%;">Fecha</th>
            <th style="width:16%;">Remito ID</th>
            <th style="width:46%;">Detalle Dispensado</th>
            <th style="width:22%;">Responsable</th>
          </tr>
        </thead>
        <tbody>
          ${dispensasRows}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h3>Detalle de Aportes Económicos</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:15%;">Fecha</th>
            <th style="width:39%;">Concepto</th>
            <th style="width:28%;">Medio de Pago / Ref</th>
            <th class="num" style="width:18%;">Monto</th>
          </tr>
        </thead>
        <tbody>
          ${aportesRows}
        </tbody>
      </table>
      <div class="total-row">
        Total Aportado: ${escapeHtml(formatCurrencyAr(totalAportado))}
      </div>
    </div>

    <div class="legal-block">
      <p class="legal-text">${escapeHtml(datos.pie_legal || '')}</p>
      ${annulBox}
      <table class="signatures">
        <tbody>
          <tr>
            <td style="width:45%;">
              <div class="sig-line"></div>
              <span class="sig-label">Responsable de Dispensa ACIACAM</span>
            </td>
            <td style="width:10%;"></td>
            <td style="width:45%;">
              <div class="sig-line"></div>
              <span class="sig-label">Firma del Asociado / Recibido</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="doc-footer">
      <div><strong>Constancia N°:</strong> ${escapeHtml(input.numeroConstancia)} | <strong>Generado el:</strong> ${escapeHtml(formatDateTimeAr(input.fechaGeneracion))}</div>
      <div class="hash-line"><strong>Firma Criptográfica SHA-256:</strong> ${escapeHtml(input.hashSha256)}</div>
    </div>
  </div>
</body>
</html>`;
}

export function printConstanciaHtml(html: string): Promise<void> {
    return new Promise((resolve) => {
        if (typeof document === 'undefined') {
            resolve();
            return;
        }
        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            setTimeout(() => {
                iframe.remove();
                resolve();
            }, 300);
        };

        iframe.onload = () => {
            const win = iframe.contentWindow;
            if (!win) {
                cleanup();
                return;
            }
            win.addEventListener('afterprint', cleanup, { once: true });
            setTimeout(() => {
                try {
                    win.focus();
                    win.print();
                } finally {
                    setTimeout(cleanup, 2000);
                }
            }, 60);
        };

        iframe.srcdoc = html;
        document.body.appendChild(iframe);
    });
}

export function downloadConstanciaHtml(html: string, filename: string): void {
    if (typeof document === 'undefined') return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
