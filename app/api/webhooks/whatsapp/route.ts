import { NextRequest, NextResponse } from 'next/server';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';

/**
 * GET /api/webhooks/whatsapp
 * Meta usa esto para verificar que el webhook existe y es válido
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const hubMode = searchParams.get('hub.mode');
  const hubVerifyToken = searchParams.get('hub.verify_token');
  const hubChallenge = searchParams.get('hub.challenge');

  console.log('Webhook verification request:', {
    mode: hubMode,
    tokenMatch: hubVerifyToken === VERIFY_TOKEN,
  });

  // Meta envía estos parámetros para verificar que somos nosotros
  if (hubMode === 'subscribe' && hubVerifyToken === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    return new NextResponse(hubChallenge, { status: 200 });
  }

  console.warn('❌ Webhook verification failed - invalid token or mode');
  return NextResponse.json(
    { error: 'Invalid verify token or mode' },
    { status: 403 }
  );
}

/**
 * POST /api/webhooks/whatsapp
 * Meta envía los mensajes y cambios de estado aquí
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log('📨 Webhook received:', {
      object: body.object,
      entry: body.entry?.length,
    });

    // Validar que es un webhook de WhatsApp
    if (body.object !== 'whatsapp_business_account') {
      console.warn('⚠️ Invalid webhook object type:', body.object);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Procesar cada entrada
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const { value } = change;

        // Mensajes recibidos
        if (value.messages) {
          for (const message of value.messages) {
            console.log('💬 Message received:', {
              from: message.from,
              type: message.type,
              id: message.id,
            });

            // Aquí procesar el mensaje
            // Por ahora solo logueamos
            await handleMessage(message, value.contacts);
          }
        }

        // Cambios de estado de mensajes enviados
        if (value.statuses) {
          for (const status of value.statuses) {
            console.log('📊 Message status:', {
              messageId: status.id,
              status: status.status,
              timestamp: status.timestamp,
            });

            await handleMessageStatus(status);
          }
        }
      }
    }

    // Siempre responder 200 para que Meta sepa que recibimos
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Procesar un mensaje recibido
 */
async function handleMessage(
  message: any,
  contacts: any[] = []
) {
  const { from, type, text, id } = message;
  const contact = contacts?.find((c) => c.wa_id === from);
  const senderName = contact?.profile?.name || 'Unknown';

  console.log(`📝 Processing ${type} message from ${senderName} (${from})`);

  // Aquí iría la lógica de procesar mensajes
  // Por ejemplo:
  // - Guardar en base de datos
  // - Procesar con IA
  // - Enviar respuesta automática
  // etc.

  // Por ahora, solo log
  if (type === 'text') {
    console.log(`   Message: "${text?.body}"`);
  } else if (type === 'document' || type === 'image') {
    console.log(`   ${type.toUpperCase()} attachment`);
  }
}

/**
 * Procesar cambios de estado de mensajes
 */
async function handleMessageStatus(status: any) {
  const { id, status: statusValue, timestamp } = status;

  console.log(`📮 Message ${id} is now: ${statusValue}`);

  // Aquí iría la lógica de actualizar el estado en la BD
  // Por ejemplo:
  // - Actualizar documento enviado
  // - Marcar como leído
  // etc.
}
