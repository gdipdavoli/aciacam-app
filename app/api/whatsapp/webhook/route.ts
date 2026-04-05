// app/api/whatsapp/webhook/route.ts
// ACIACAM - Agente de documentación vía WhatsApp
// ================================================
// Requiere en .env:
//   WHATSAPP_VERIFY_TOKEN=un_string_secreto_que_vos_elijas
//   WHATSAPP_ACCESS_TOKEN=token_permanente_de_meta
//   WHATSAPP_PHONE_NUMBER_ID=id_del_numero_en_meta
//   ANTHROPIC_API_KEY=tu_api_key_de_anthropic
//   NEXT_PUBLIC_SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ── Clientes ──────────────────────────────────────────────
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role para bypass de RLS en server
);

// ── Tipos ─────────────────────────────────────────────────
type TipoDocumento = 'dni' | 'reprocann' | 'consentimiento' | 'declaracion_jurada';

interface WhatsAppMessage {
  from: string;       // número del socio
  id: string;
  type: 'text' | 'image' | 'document' | 'audio';
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
}

// ── GET: verificación del webhook con Meta ─────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verificado por Meta');
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Token inválido' }, { status: 403 });
}

// ── POST: recibe mensajes entrantes ───────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Extraer mensaje del payload de Meta
    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message: WhatsAppMessage = value?.messages?.[0];

    if (!message) {
      // Puede ser una notificación de estado (delivered, read), no un mensaje
      return NextResponse.json({ status: 'ok' });
    }

    const from = message.from; // ej: "5491112345678"
    console.log(`Mensaje de ${from}, tipo: ${message.type}`);

    // Buscar el socio por número de teléfono
    const socio = await getSocioPorTelefono(from);

    if (!socio) {
      await enviarMensaje(from,
        '¡Hola! No encontramos tu número en nuestro sistema. ' +
        'Por favor contactá a ACIACAM directamente para registrarte.'
      );
      return NextResponse.json({ status: 'ok' });
    }

    // Procesar según tipo de mensaje
    if (message.type === 'text') {
      await procesarMensajeTexto(socio, from, message.text!.body);
    } else if (message.type === 'image' || message.type === 'document') {
      await procesarDocumento(socio, from, message);
    } else {
      await enviarMensaje(from,
        'Por el momento solo podemos recibir fotos y documentos PDF. ' +
        'Mandanos la imagen de tu documento.'
      );
    }

    return NextResponse.json({ status: 'ok' });

  } catch (error) {
    console.error('Error en webhook WhatsApp:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

// ── Buscar socio por teléfono ─────────────────────────────
async function getSocioPorTelefono(telefono: string) {
  // El número llega como "5491112345678" (sin +)
  // En la DB puede estar guardado como "1112345678", "011-1112345678", etc.
  // Normalizamos buscando los últimos 10 dígitos
  const ultimos10 = telefono.slice(-10);

  const { data } = await supabase
    .from('socios')
    .select('id, nombre, apellido, email, telefono')
    .ilike('telefono', `%${ultimos10}`)
    .maybeSingle();

  return data;
}

// ── Procesar texto: bienvenida o consulta ─────────────────
async function procesarMensajeTexto(socio: any, from: string, texto: string) {
  const textoLower = texto.toLowerCase().trim();

  // Comandos básicos
  if (textoLower === 'hola' || textoLower === 'inicio' || textoLower === 'start') {
    await enviarBienvenida(socio, from);
    return;
  }

  if (textoLower === 'estado' || textoLower === 'mis documentos') {
    await enviarEstadoDocumentacion(socio, from);
    return;
  }

  // Para cualquier otro texto, responder con instrucciones
  await enviarMensaje(from,
    `¡Hola ${socio.nombre}! 👋\n\n` +
    `Podés enviarme:\n` +
    `📸 *Foto* de tu DNI (frente)\n` +
    `📄 *PDF* de tu certificado Reprocann\n` +
    `📋 *Foto* del consentimiento informado firmado\n` +
    `📝 *Foto* de la declaración jurada firmada\n\n` +
    `O escribí *estado* para ver qué documentos tenemos de vos.`
  );
}

// ── Procesar imagen/documento: analizar con Claude ────────
async function procesarDocumento(socio: any, from: string, message: WhatsAppMessage) {
  // 1. Avisar que estamos procesando
  await enviarMensaje(from, '📎 Recibimos tu documento, lo estamos analizando...');

  try {
    // 2. Descargar el archivo desde la API de Meta
    const mediaId = message.image?.id || message.document?.id;
    const mimeType = message.image?.mime_type || message.document?.mime_type || 'image/jpeg';
    const { buffer, extension } = await descargarMediaMeta(mediaId!);

    // 3. Analizar con Claude Vision para identificar tipo de documento
    const analisis = await analizarDocumentoConClaude(buffer, mimeType, message);

    // 4. Subir al Storage de Supabase
    const path = `${socio.id}/${analisis.tipo}_${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from('documentos-socios')
      .upload(path, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) throw uploadError;

    // 5. Guardar en documentos_socio
    await supabase
      .from('documentos_socio')
      .upsert({
        socio_id: socio.id,
        tipo: analisis.tipo,
        archivo_path: path,
        verificacion_estado: 'pendiente',
        uploaded_by: 'socio_whatsapp',
        ...(analisis.fecha_vencimiento && { fecha_vencimiento: analisis.fecha_vencimiento }),
      }, { onConflict: 'socio_id,tipo' });

    // 6. Responder al socio con el resultado
    if (analisis.tipo === 'desconocido') {
      await enviarMensaje(from,
        `⚠️ No pudimos identificar qué tipo de documento es este.\n\n` +
        `Necesitamos:\n` +
        `• DNI (frente)\n` +
        `• Certificado Reprocann\n` +
        `• Consentimiento informado\n` +
        `• Declaración jurada\n\n` +
        `¿Podés mandarlo de nuevo más claro?`
      );
    } else {
      const nombreDoc: Record<string, string> = {
        dni:               'DNI',
        reprocann:         'Certificado Reprocann',
        consentimiento:    'Consentimiento informado',
        declaracion_jurada: 'Declaración jurada',
      };

      let respuesta = `✅ *${nombreDoc[analisis.tipo]}* recibido correctamente.\n\n`;
      respuesta += `📋 Estado: Pendiente de revisión por el equipo de ACIACAM.\n`;

      if (analisis.fecha_vencimiento) {
        const fecha = new Date(analisis.fecha_vencimiento).toLocaleDateString('es-AR');
        respuesta += `📅 Vencimiento detectado: ${fecha}\n`;
      }

      respuesta += `\nTe avisaremos cuando sea revisado. ¿Tenés otro documento para enviar?`;
      await enviarMensaje(from, respuesta);
    }

    // 7. Notificar al equipo interno (log en audit)
    await supabase.from('audit_logs').insert({
      user_id: '00000000-0000-0000-0000-000000000000', // sistema
      action: 'DOCUMENTO_RECIBIDO_WA',
      entity_type: 'DOCUMENTO',
      entity_id: socio.id,
      details: {
        socio_nombre: `${socio.nombre} ${socio.apellido}`,
        tipo: analisis.tipo,
        from_number: from,
        path,
      },
    });

  } catch (error) {
    console.error('Error procesando documento:', error);
    await enviarMensaje(from,
      '❌ Hubo un problema al procesar tu documento. ' +
      'Por favor intentá de nuevo en unos minutos.'
    );
  }
}

// ── Analizar documento con Claude Vision ──────────────────
async function analizarDocumentoConClaude(
  buffer: Buffer,
  mimeType: string,
  message: WhatsAppMessage
): Promise<{ tipo: TipoDocumento | 'desconocido'; fecha_vencimiento?: string }> {

  const base64 = buffer.toString('base64');
  const caption = message.image?.caption || message.document?.caption || '';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType as any, data: base64 },
        },
        {
          type: 'text',
          text: `Analizá este documento enviado por un socio de ACIACAM (ONG de cannabis medicinal en Argentina).

Ley aplicable: Ley 26350 y resoluciones del Ministerio de Salud de la Nación.

Identificá:
1. Tipo de documento. Opciones exactas:
   - "dni": Documento Nacional de Identidad argentino
   - "reprocann": Certificado o constancia del Registro del Programa de Cannabis (REPROCANN)
   - "consentimiento": Formulario de consentimiento informado firmado
   - "declaracion_jurada": Declaración jurada
   - "desconocido": si no podés identificarlo claramente

2. Fecha de vencimiento (solo si aplica, especialmente para reprocann). Formato ISO: YYYY-MM-DD. Si no hay fecha de vencimiento, omitir.

${caption ? `El socio escribió: "${caption}"` : ''}

Respondé ÚNICAMENTE con JSON válido, sin texto adicional:
{"tipo": "...", "fecha_vencimiento": "YYYY-MM-DD"}

Si no hay fecha de vencimiento: {"tipo": "..."}`,
        },
      ],
    }],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const resultado = JSON.parse(text.trim());
    return {
      tipo: resultado.tipo || 'desconocido',
      fecha_vencimiento: resultado.fecha_vencimiento,
    };
  } catch {
    return { tipo: 'desconocido' };
  }
}

// ── Descargar media desde la API de Meta ──────────────────
async function descargarMediaMeta(mediaId: string): Promise<{ buffer: Buffer; extension: string }> {
  // 1. Obtener URL de descarga
  const urlRes = await fetch(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
  );
  const { url, mime_type } = await urlRes.json();

  // 2. Descargar el archivo
  const fileRes = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
  });
  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const extension = mime_type?.includes('pdf') ? 'pdf'
    : mime_type?.includes('png') ? 'png'
    : 'jpg';

  return { buffer, extension };
}

// ── Enviar bienvenida personalizada ──────────────────────
async function enviarBienvenida(socio: any, from: string) {
  // Ver qué documentos ya tiene
  const { data: docs } = await supabase
    .from('documentos_socio')
    .select('tipo, verificacion_estado')
    .eq('socio_id', socio.id);

  const tiposRequeridos: TipoDocumento[] = ['dni', 'reprocann', 'consentimiento', 'declaracion_jurada'];
  const tiposEntregados = docs?.map(d => d.tipo) || [];
  const tiposFaltantes = tiposRequeridos.filter(t => !tiposEntregados.includes(t));

  const nombresDoc: Record<string, string> = {
    dni: 'DNI',
    reprocann: 'Certificado Reprocann',
    consentimiento: 'Consentimiento informado',
    declaracion_jurada: 'Declaración jurada',
  };

  let mensaje = `¡Hola ${socio.nombre}! Soy el asistente de *ACIACAM* 🌿\n\n`;

  if (tiposFaltantes.length === 0) {
    mensaje += '✅ ¡Tenemos toda tu documentación! El equipo la está revisando.';
  } else {
    mensaje += `Necesitamos los siguientes documentos:\n`;
    tiposFaltantes.forEach(t => { mensaje += `• ${nombresDoc[t]}\n`; });
    mensaje += `\nMandame una foto o PDF de cada uno por acá.`;
  }

  await enviarMensaje(from, mensaje);
}

// ── Enviar estado de documentación ───────────────────────
async function enviarEstadoDocumentacion(socio: any, from: string) {
  const { data: docs } = await supabase
    .from('documentos_socio')
    .select('tipo, verificacion_estado')
    .eq('socio_id', socio.id);

  const tiposRequeridos = ['dni', 'reprocann', 'consentimiento', 'declaracion_jurada'];
  const estadoEmoji: Record<string, string> = {
    aprobado: '✅',
    pendiente: '⏳',
    en_revision: '🔍',
    rechazado: '❌',
  };

  const nombresDoc: Record<string, string> = {
    dni: 'DNI',
    reprocann: 'Certificado Reprocann',
    consentimiento: 'Consentimiento informado',
    declaracion_jurada: 'Declaración jurada',
  };

  let mensaje = `📋 *Estado de tu documentación, ${socio.nombre}:*\n\n`;

  tiposRequeridos.forEach(tipo => {
    const doc = docs?.find(d => d.tipo === tipo);
    if (doc) {
      const emoji = estadoEmoji[doc.verificacion_estado] || '⏳';
      mensaje += `${emoji} ${nombresDoc[tipo]}: ${doc.verificacion_estado}\n`;
    } else {
      mensaje += `📭 ${nombresDoc[tipo]}: *No recibido*\n`;
    }
  });

  await enviarMensaje(from, mensaje);
}

// ── Enviar mensaje por WhatsApp Cloud API ─────────────────
async function enviarMensaje(to: string, texto: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: texto },
      }),
    }
  );
}
