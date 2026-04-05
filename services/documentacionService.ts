import { supabase } from './supabaseClient';

export type TipoDocumento = 'dni' | 'reprocann' | 'consentimiento' | 'declaracion_jurada';
export type EstadoVerificacion = 'pendiente' | 'en_revision' | 'aprobado' | 'rechazado';
export type UploadedBy = 'socio_web' | 'socio_whatsapp' | 'admin' | 'staff';

export interface DocumentoSocio {
  id: string;
  socio_id: string;
  tipo: TipoDocumento;
  archivo_path: string | null;
  estado: string | null;
  verificacion_estado: EstadoVerificacion;
  verificacion_obs: string | null;
  verificado_at: string | null;
  verificado_por: string | null;
  fecha_vencimiento: string | null;
  uploaded_by: UploadedBy | null;
  recordatorios_enviados: number;
  ultimo_recordatorio_at: string | null;
  created_at: string | null;
}

export interface EstadoDocumentacionSocio {
  socio_id: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  dni_estado: EstadoVerificacion | null;
  dni_archivo: string | null;
  reprocann_estado: EstadoVerificacion | null;
  reprocann_vencimiento: string | null;
  reprocann_archivo: string | null;
  consentimiento_estado: EstadoVerificacion | null;
  consentimiento_archivo: string | null;
  ddjj_estado: EstadoVerificacion | null;
  ddjj_archivo: string | null;
  docs_entregados: number;
  docs_aprobados: number;
  reprocann_por_vencer: boolean;
}

// ── LECTURA ──────────────────────────────────────────────────

/**
 * Obtiene todos los documentos de un socio
 */
export const getDocumentosBySocio = async (socioId: string): Promise<DocumentoSocio[]> => {
  const { data, error } = await supabase
    .from('documentos_socio')
    .select('*')
    .eq('socio_id', socioId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getDocumentosBySocio error:', error);
    return [];
  }
  return data || [];
};

/**
 * Obtiene un documento específico por socio y tipo
 */
export const getDocumentoByTipo = async (
  socioId: string,
  tipo: TipoDocumento
): Promise<DocumentoSocio | null> => {
  const { data, error } = await supabase
    .from('documentos_socio')
    .select('*')
    .eq('socio_id', socioId)
    .eq('tipo', tipo)
    .maybeSingle();

  if (error) {
    console.error('getDocumentoByTipo error:', error);
    return null;
  }
  return data;
};

/**
 * Vista consolidada del estado de documentación de todos los socios
 * Útil para el panel interno del equipo de ACIACAM
 */
export const getEstadoDocumentacionTodos = async (): Promise<EstadoDocumentacionSocio[]> => {
  const { data, error } = await supabase
    .from('v_documentacion_socios')
    .select('*')
    .order('apellido');

  if (error) {
    console.error('getEstadoDocumentacionTodos error:', error);
    return [];
  }
  return data || [];
};

/**
 * Socios con documentación incompleta (para el agente de seguimiento)
 */
export const getSociosConDocsPendientes = async (): Promise<EstadoDocumentacionSocio[]> => {
  const { data, error } = await supabase
    .from('v_documentacion_socios')
    .select('*')
    .lt('docs_aprobados', 4); // menos de los 4 documentos requeridos

  if (error) {
    console.error('getSociosConDocsPendientes error:', error);
    return [];
  }
  return data || [];
};

/**
 * Socios con Reprocann por vencer en los próximos N días
 */
export const getSociosReprocannPorVencer = async (diasAnticipacion = 30): Promise<DocumentoSocio[]> => {
  const hasta = new Date();
  hasta.setDate(hasta.getDate() + diasAnticipacion);

  const { data, error } = await supabase
    .from('documentos_socio')
    .select('*, socios(nombre, apellido, email, telefono)')
    .eq('tipo', 'reprocann')
    .eq('verificacion_estado', 'aprobado')
    .lte('fecha_vencimiento', hasta.toISOString())
    .gte('fecha_vencimiento', new Date().toISOString())
    .order('fecha_vencimiento');

  if (error) {
    console.error('getSociosReprocannPorVencer error:', error);
    return [];
  }
  return data || [];
};

// ── ESCRITURA ─────────────────────────────────────────────────

/**
 * Crear o actualizar un documento (upsert por socio_id + tipo)
 * Reemplaza el updateSocioDocumentacion() vacío en storeService.ts
 */
export const upsertDocumentoSocio = async (
  socioId: string,
  tipo: TipoDocumento,
  updates: {
    archivo_path?: string;
    estado?: string;
    verificacion_estado?: EstadoVerificacion;
    verificacion_obs?: string;
    fecha_vencimiento?: string;
    uploaded_by?: UploadedBy;
  }
): Promise<DocumentoSocio | null> => {
  const { data, error } = await supabase
    .from('documentos_socio')
    .upsert(
      {
        socio_id: socioId,
        tipo,
        ...updates,
      },
      { onConflict: 'socio_id,tipo' }
    )
    .select()
    .single();

  if (error) {
    console.error('upsertDocumentoSocio error:', error);
    throw error;
  }
  return data;
};

/**
 * El admin verifica (aprueba o rechaza) un documento
 */
export const verificarDocumento = async (
  documentoId: string,
  estado: 'aprobado' | 'rechazado',
  observaciones: string | null,
  verificadoPor: string // email o nombre del admin
): Promise<void> => {
  const { error } = await supabase
    .from('documentos_socio')
    .update({
      verificacion_estado: estado,
      verificacion_obs: observaciones,
      verificado_at: new Date().toISOString(),
      verificado_por: verificadoPor,
    })
    .eq('id', documentoId);

  if (error) {
    console.error('verificarDocumento error:', error);
    throw error;
  }
};

/**
 * Registra que se envió un recordatorio al socio (incrementa contador)
 * Lo llama el agente WA después de enviar el mensaje
 */
export const registrarRecordatorioEnviado = async (
  socioId: string,
  tipo: TipoDocumento
): Promise<void> => {
  // Primero obtenemos el doc para incrementar
  const doc = await getDocumentoByTipo(socioId, tipo);

  if (!doc) {
    // Si no existe el doc todavía, lo creamos como pendiente
    await upsertDocumentoSocio(socioId, tipo, {
      verificacion_estado: 'pendiente',
    });
  }

  const { error } = await supabase.rpc('incrementar_recordatorio', {
    p_socio_id: socioId,
    p_tipo: tipo,
  });

  // Fallback si el RPC no existe: update manual
  if (error) {
    const { error: updateError } = await supabase
      .from('documentos_socio')
      .update({
        recordatorios_enviados: (doc?.recordatorios_enviados ?? 0) + 1,
        ultimo_recordatorio_at: new Date().toISOString(),
      })
      .eq('socio_id', socioId)
      .eq('tipo', tipo);

    if (updateError) console.error('registrarRecordatorioEnviado error:', updateError);
  }
};

// ── STORAGE ───────────────────────────────────────────────────

/**
 * Sube un archivo de documento al Storage de Supabase
 * y guarda el path en documentos_socio
 */
export const uploadDocumento = async (
  socioId: string,
  tipo: TipoDocumento,
  file: File,
  uploadedBy: UploadedBy = 'socio_web'
): Promise<DocumentoSocio | null> => {
  // 1. Subir al bucket 'documentos-socios'
  const ext = file.name.split('.').pop();
  const path = `${socioId}/${tipo}_${Date.now()}.${ext}`;

  const { error: storageError } = await supabase.storage
    .from('documentos-socios')
    .upload(path, file, { upsert: true });

  if (storageError) {
    console.error('uploadDocumento storage error:', storageError);
    throw storageError;
  }

  // 2. Guardar path en la tabla
  return upsertDocumentoSocio(socioId, tipo, {
    archivo_path: path,
    verificacion_estado: 'pendiente',
    uploaded_by: uploadedBy,
  });
};

/**
 * Obtiene la URL pública (o signed URL) de un documento
 */
export const getUrlDocumento = async (archivoPath: string): Promise<string | null> => {
  const { data } = await supabase.storage
    .from('documentos-socios')
    .createSignedUrl(archivoPath, 60 * 60); // 1 hora de validez

  return data?.signedUrl ?? null;
};
