"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { StorageService } from '@/services/storageService';
import { 
    isValidCalendarDate, 
    formatCalendarDate, 
    getSanLuisCivilToday 
} from '@/app/lib/date-format';
import { 
    UnifiedDocumentExtraction, 
    validateUnifiedExtraction,
    consolidateDocumentExtractions,
    DocumentConflict,
    FieldTraceability,
    normalizeDni 
} from '@/app/lib/ocr-contract';
import { 
    ArrowLeft, 
    ArrowRight, 
    Check, 
    User, 
    ShieldCheck, 
    Stethoscope, 
    Save, 
    Send, 
    Upload, 
    Trash2, 
    AlertCircle, 
    CheckCircle,
    Truck,
    Info,
    Calendar,
    FileCheck,
    FileText,
    Sparkles,
    Eye,
    X,
    FileUp,
    Clock,
    XCircle,
    CheckSquare,
    RefreshCw
} from 'lucide-react';

const STORAGE_KEY = 'aciacam_new_socio_draft_v4';

export type SituacionReprocann = 'vigente' | 'vencido' | 'en_tramite' | 'no_posee';

export interface AttachedDocState {
    id: string;
    file: File;
    tipo: string;
    verificacionEstado: 'aprobado' | 'pendiente' | 'rechazado' | '';
    verificacionObs: string;
    fechaEmision: string;
    fechaVencimiento: string;
    numeroTramite: string;
    extraction?: UnifiedDocumentExtraction;
}

interface FormData {
    // Paso 3: Identificación y Contacto
    nombre: string;
    apellido: string;
    dni: string;
    fechaNacimiento: string; // YYYY-MM-DD
    email: string;
    telefono: string;
    direccion: string;
    localidad: string;
    enviosHabilitados: boolean; // Delivery habilitado por defecto
    idempotencyKey: string; // Clave de idempotencia única por operación

    // Situación REPROCANN
    situacionReprocann: SituacionReprocann;
    numeroTramite: string;
    fechaAlta: string;
    fechaVencimiento: string;
    tipoVinculacion: string;

    // Información Médica
    medicoNombre: string;
    medicoMatricula: string;
    diagnosticoPrincipal: string;

    // Metadatos de origen
    fuenteExtraccion?: string;
    camposExtraidos?: string[];
}

const INITIAL_FORM: FormData = {
    nombre: '',
    apellido: '',
    dni: '',
    fechaNacimiento: '',
    email: '',
    telefono: '',
    direccion: '',
    localidad: '',
    enviosHabilitados: true,
    idempotencyKey: '',

    situacionReprocann: 'vigente',
    numeroTramite: '',
    fechaAlta: '',
    fechaVencimiento: '',
    tipoVinculacion: 'ong',

    medicoNombre: '',
    medicoMatricula: '',
    diagnosticoPrincipal: '',

    fuenteExtraccion: undefined,
    camposExtraidos: []
};

export default function NewSocioWizardPage() {
    const { user } = useAuth();
    const router = useRouter();

    const [currentStep, setCurrentStep] = useState<number>(1);
    const [formData, setFormData] = useState<FormData>(INITIAL_FORM);

    // Documentos adjuntados en el alta
    const [attachedDocs, setAttachedDocs] = useState<AttachedDocState[]>([]);
    const [isExtracting, setIsExtracting] = useState<boolean>(false);
    const [isRetryingDocId, setIsRetryingDocId] = useState<string | null>(null);
    const [fieldTraceability, setFieldTraceability] = useState<Record<string, FieldTraceability>>({});
    const [extractionSummary, setExtractionSummary] = useState<UnifiedDocumentExtraction | null>(null);
    const [conflicts, setConflicts] = useState<DocumentConflict[]>([]);
    const [manuallyEditedFields, setManuallyEditedFields] = useState<Set<string>>(new Set());
    const [previewDoc, setPreviewDoc] = useState<{ name: string; url: string; isPdf: boolean } | null>(null);

    const [loading, setLoading] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [bannerError, setBannerError] = useState<string | null>(null);
    const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

    // 1. Cargar borrador de localStorage
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        const freshKey = `alta_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setFormData(prev => ({ 
                    ...prev, 
                    ...parsed,
                    idempotencyKey: parsed.idempotencyKey || freshKey
                }));
            } catch (e) {
                console.error("Error al cargar borrador de socio", e);
                setFormData(prev => ({ ...prev, idempotencyKey: freshKey }));
            }
        } else {
            setFormData(prev => ({ ...prev, idempotencyKey: freshKey }));
        }
        setIsLoaded(true);
    }, []);

    // 2. Guardar borrador en localStorage automáticamente (debounced)
    useEffect(() => {
        if (!isLoaded) return;
        const timeout = setTimeout(() => {
            // Guardar solo datos de formulario (sin archivos binarios)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
        }, 600);
        return () => clearTimeout(timeout);
    }, [formData, isLoaded]);

    const handleChange = (field: keyof FormData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setManuallyEditedFields(prev => new Set(prev).add(field as string));
        if (validationError) setValidationError(null);
        if (bannerError) setBannerError(null);
    };

    const handleClearDraft = () => {
        if (window.confirm("¿Seguro que deseás descartar el borrador actual? Se restablecerán todos los campos.")) {
            localStorage.removeItem(STORAGE_KEY);
            const freshKey = `alta_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            setFormData({ ...INITIAL_FORM, idempotencyKey: freshKey });
            setAttachedDocs([]);
            setExtractionSummary(null);
            setFieldTraceability({});
            setConflicts([]);
            setCurrentStep(1);
            setValidationError(null);
            setBannerError(null);
        }
    };

    // Subida y procesamiento de documentos (Paso 1)
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, defaultTipo = 'reprocann') => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const newDocs: AttachedDocState[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const docId = `doc_${Date.now()}_${i}`;

            // Determinar tipo tentativo según nombre
            let tipo = defaultTipo;
            const fnLower = file.name.toLowerCase();
            if (fnLower.includes('consentimiento')) tipo = 'consentimiento';
            else if (fnLower.includes('tramite') || fnLower.includes('constancia')) tipo = 'constancia_tramite';
            else if (fnLower.includes('dni')) tipo = 'dni';
            else if (fnLower.includes('declaracion')) tipo = 'declaracion_jurada';

            newDocs.push({
                id: docId,
                file,
                tipo,
                verificacionEstado: '', // Sin aprobación automática inicial: exige decisión administrativa explícita en Paso 4
                verificacionObs: '',
                fechaEmision: '',
                fechaVencimiento: '',
                numeroTramite: ''
            });
        }

        // Reset input value para permitir re-selección
        e.target.value = '';

        const combinedDocs = [...attachedDocs, ...newDocs];
        setAttachedDocs(combinedDocs);
        setValidationError(null);

        // Procesar extracción de los documentos nuevos y consolidar con los existentes
        if (newDocs.length > 0) {
            await processAndConsolidateDocs(combinedDocs, newDocs);
        }
    };

    // Ejecuta la extracción de documentos nuevos y consolida el resultado general
    const processAndConsolidateDocs = async (allDocs: AttachedDocState[], docsToProcess: AttachedDocState[]) => {
        setIsExtracting(true);
        setBannerError(null);

        try {
            const updatedDocs = [...allDocs];

            // 1. Procesar cada documento nuevo
            for (const doc of docsToProcess) {
                try {
                    const formDataReq = new FormData();
                    formDataReq.append('file', doc.file);

                    const res = await fetch('/api/admin/documents/extract', {
                        method: 'POST',
                        body: formDataReq
                    });

                    if (res.ok) {
                        const data = await res.json();
                        const ext: UnifiedDocumentExtraction = data.extraction;

                        const idx = updatedDocs.findIndex(d => d.id === doc.id);
                        if (idx >= 0) {
                            updatedDocs[idx] = {
                                ...updatedDocs[idx],
                                extraction: ext,
                                fechaEmision: ext.fechaEmision || updatedDocs[idx].fechaEmision,
                                fechaVencimiento: ext.fechaVencimiento || updatedDocs[idx].fechaVencimiento,
                                numeroTramite: ext.numeroTramite || updatedDocs[idx].numeroTramite,
                                tipo: ext.documentType !== 'desconocido' ? ext.documentType : updatedDocs[idx].tipo
                            };
                        }
                    } else {
                        const errData = await res.json().catch(() => ({}));
                        console.warn(`Error en extracción de ${doc.file.name}:`, errData.error);
                    }
                } catch (docErr: any) {
                    console.warn(`Fallo en procesamiento de archivo ${doc.file.name}:`, docErr.message);
                }
            }

            setAttachedDocs(updatedDocs);

            // 2. Consolidar todas las extracciones disponibles
            const itemsToConsolidate = updatedDocs
                .filter(d => d.extraction)
                .map(d => ({
                    filename: d.file.name,
                    extraction: d.extraction!
                }));

            if (itemsToConsolidate.length > 0) {
                const consolidation = consolidateDocumentExtractions(itemsToConsolidate);
                setConflicts(consolidation.conflicts);
                setFieldTraceability(consolidation.fieldTraceability || {});

                // Extracción representativa
                const primaryExt = itemsToConsolidate.find(i => i.extraction.isLegible && !i.extraction.requiresVisualOcr)?.extraction
                    || itemsToConsolidate[0].extraction;
                setExtractionSummary(primaryExt);

                // 3. Precargar formulario con campos consolidados sin sobreescribir datos cargados manualmente
                const c = consolidation.consolidated;
                const extractedFieldNames: string[] = [];

                setFormData(prev => {
                    const updated = { ...prev };
                    if (c.nombre && !prev.nombre && !manuallyEditedFields.has('nombre')) { updated.nombre = c.nombre; extractedFieldNames.push('nombre'); }
                    if (c.apellido && !prev.apellido && !manuallyEditedFields.has('apellido')) { updated.apellido = c.apellido; extractedFieldNames.push('apellido'); }
                    if (c.dni && !prev.dni && !manuallyEditedFields.has('dni')) { updated.dni = c.dni; extractedFieldNames.push('dni'); }
                    if (c.fechaNacimiento && !prev.fechaNacimiento && !manuallyEditedFields.has('fechaNacimiento')) { updated.fechaNacimiento = c.fechaNacimiento; extractedFieldNames.push('fechaNacimiento'); }
                    if (c.numeroTramite && !prev.numeroTramite && !manuallyEditedFields.has('numeroTramite')) { updated.numeroTramite = c.numeroTramite; extractedFieldNames.push('numeroTramite'); }
                    if (c.fechaAlta && !prev.fechaAlta && !manuallyEditedFields.has('fechaAlta')) { updated.fechaAlta = c.fechaAlta; extractedFieldNames.push('fechaAlta'); }
                    if (c.fechaVencimiento && !prev.fechaVencimiento && !manuallyEditedFields.has('fechaVencimiento')) { updated.fechaVencimiento = c.fechaVencimiento; extractedFieldNames.push('fechaVencimiento'); }
                    if (c.medicoNombre && !prev.medicoNombre && !manuallyEditedFields.has('medicoNombre')) { updated.medicoNombre = c.medicoNombre; extractedFieldNames.push('medicoNombre'); }
                    if (c.medicoMatricula && !prev.medicoMatricula && !manuallyEditedFields.has('medicoMatricula')) { updated.medicoMatricula = c.medicoMatricula; extractedFieldNames.push('medicoMatricula'); }
                    if (c.diagnosticoPrincipal && !prev.diagnosticoPrincipal && !manuallyEditedFields.has('diagnosticoPrincipal')) { updated.diagnosticoPrincipal = c.diagnosticoPrincipal; extractedFieldNames.push('diagnosticoPrincipal'); }

                    if (c.fechaVencimiento) {
                        const today = getSanLuisCivilToday();
                        const todayStr = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
                        if (c.fechaVencimiento >= todayStr) {
                            updated.situacionReprocann = 'vigente';
                        } else {
                            updated.situacionReprocann = 'vencido';
                        }
                    }

                    updated.fuenteExtraccion = c.fuenteExtraccion || primaryExt.sourceDescription;
                    updated.camposExtraidos = Array.from(new Set([...(prev.camposExtraidos || []), ...extractedFieldNames]));

                    return updated;
                });
            }

            // Pasar automáticamente al paso 2
            setCurrentStep(2);

        } catch (e: any) {
            console.warn("Fallo de extracción asistida:", e.message);
            setBannerError(`Nota: ${e.message}. Podés ingresar o corregir los datos manualmente.`);
            setCurrentStep(2);
        } finally {
            setIsExtracting(false);
        }
    };

    const handleRemoveDoc = (id: string) => {
        setAttachedDocs(prev => {
            const filtered = prev.filter(d => d.id !== id);
            const items = filtered
                .filter(d => d.extraction)
                .map(d => ({ filename: d.file.name, extraction: d.extraction! }));
            
            if (items.length > 0) {
                const consolidation = consolidateDocumentExtractions(items);
                setConflicts(consolidation.conflicts);
                setFieldTraceability(consolidation.fieldTraceability || {});
                setExtractionSummary(items[0].extraction);
            } else {
                setConflicts([]);
                setFieldTraceability({});
                setExtractionSummary(null);
            }
            return filtered;
        });
    };

    // Reintento manual granular con Gemini Vision por documento (UX-03D.1)
    const handleRetryDocumentWithGemini = async (docId: string) => {
        const docToRetry = attachedDocs.find(d => d.id === docId);
        if (!docToRetry) return;

        setIsRetryingDocId(docId);
        setBannerError(null);
        setBannerSuccess(null);

        try {
            const formDataReq = new FormData();
            formDataReq.append('file', docToRetry.file);

            const res = await fetch('/api/admin/documents/extract', {
                method: 'POST',
                body: formDataReq
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            const ext: UnifiedDocumentExtraction = data.extraction;

            const updatedDocs = attachedDocs.map(d => {
                if (d.id === docId) {
                    return {
                        ...d,
                        extraction: ext,
                        fechaEmision: ext.fechaEmision || d.fechaEmision,
                        fechaVencimiento: ext.fechaVencimiento || d.fechaVencimiento,
                        numeroTramite: ext.numeroTramite || d.numeroTramite,
                        tipo: ext.documentType !== 'desconocido' ? ext.documentType : d.tipo
                    };
                }
                return d;
            });

            setAttachedDocs(updatedDocs);

            // Re-consolidar documentos con la nueva extracción
            const itemsToConsolidate = updatedDocs
                .filter(d => d.extraction)
                .map(d => ({
                    filename: d.file.name,
                    extraction: d.extraction!
                }));

            if (itemsToConsolidate.length > 0) {
                const consolidation = consolidateDocumentExtractions(itemsToConsolidate);
                setConflicts(consolidation.conflicts);
                setFieldTraceability(consolidation.fieldTraceability || {});

                const primaryExt = itemsToConsolidate.find(i => i.extraction.isLegible && !i.extraction.requiresVisualOcr)?.extraction
                    || itemsToConsolidate[0].extraction;
                setExtractionSummary(primaryExt);

                const c = consolidation.consolidated;
                const newlyExtractedFields: string[] = [];

                setFormData(prev => {
                    const updated = { ...prev };
                    const prevExtracted = prev.camposExtraidos || [];

                    const applyIfEligible = (fieldKey: keyof FormData, newVal: any) => {
                        if (!newVal) return;
                        const currentVal = prev[fieldKey];
                        const isManuallyEdited = manuallyEditedFields.has(fieldKey as string);
                        if (!currentVal || (prevExtracted.includes(fieldKey as string) && !isManuallyEdited)) {
                            (updated as any)[fieldKey] = newVal;
                            newlyExtractedFields.push(fieldKey as string);
                        }
                    };

                    applyIfEligible('nombre', c.nombre);
                    applyIfEligible('apellido', c.apellido);
                    applyIfEligible('dni', c.dni);
                    applyIfEligible('fechaNacimiento', c.fechaNacimiento);
                    applyIfEligible('numeroTramite', c.numeroTramite);
                    applyIfEligible('fechaAlta', c.fechaAlta);
                    applyIfEligible('fechaVencimiento', c.fechaVencimiento);
                    applyIfEligible('medicoNombre', c.medicoNombre);
                    applyIfEligible('medicoMatricula', c.medicoMatricula);
                    applyIfEligible('diagnosticoPrincipal', c.diagnosticoPrincipal);

                    if (c.fechaVencimiento && (!prev.fechaVencimiento || prevExtracted.includes('fechaVencimiento'))) {
                        const today = getSanLuisCivilToday();
                        const todayStr = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
                        updated.situacionReprocann = c.fechaVencimiento >= todayStr ? 'vigente' : 'vencido';
                    }

                    updated.fuenteExtraccion = c.fuenteExtraccion || primaryExt.sourceDescription;
                    updated.camposExtraidos = Array.from(new Set([...prevExtracted, ...newlyExtractedFields]));

                    return updated;
                });

                if (ext.extractionSource === 'agent_core_gemini') {
                    setBannerSuccess(`¡Análisis exitoso con Gemini Vision para "${docToRetry.file.name}"! Se actualizaron los datos consolidados.`);
                } else {
                    setBannerError(`Se procesó el documento pero no fue posible completar el análisis con Gemini Vision (${ext.failureReason || 'se mantuvo extracción local'}).`);
                }
            }
        } catch (err: any) {
            console.error("Error al reintentar análisis con Gemini:", err);
            setBannerError(`No se pudo reintentar con Gemini: ${err.message || 'error desconocido'}. Se conservan los datos previos.`);
        } finally {
            setIsRetryingDocId(null);
        }
    };

    // Helper visual de trazabilidad y origen de campos (UX-03D.2)
    const getFieldProvenancePill = (fieldKey: string, val: string | undefined, trace?: FieldTraceability) => {
        if (manuallyEditedFields.has(fieldKey)) {
            return {
                label: '✍️ Ingresado manualmente',
                bg: 'rgba(16, 185, 129, 0.12)',
                color: 'rgb(16, 185, 129)'
            };
        }
        if (!val || val.trim() === '') {
            return {
                label: '⚪ No detectado',
                bg: 'hsl(var(--muted))',
                color: 'hsl(var(--muted-foreground))'
            };
        }
        if (trace?.source === 'agent_core_gemini' || trace?.sourceReference?.includes('Gemini')) {
            const conf = Math.round((trace.confidence || 0.95) * 100);
            return {
                label: `🤖 Gemini (${conf}%)`,
                bg: 'rgba(124, 58, 237, 0.15)',
                color: 'rgb(124, 58, 237)'
            };
        }
        if (trace?.source === 'local_text_layer' || trace?.sourceReference?.includes('unpdf') || trace?.sourceReference?.includes('texto digital') || trace?.sourceReference?.includes('Texto digital')) {
            if (trace?.requiresReview || fieldKey === 'diagnosticoPrincipal') {
                return {
                    label: '⚠️ Pendiente de revisión',
                    bg: 'hsl(var(--warning) / 0.15)',
                    color: 'hsl(var(--warning-foreground, 38 92% 50%))'
                };
            }
            return {
                label: '📄 Texto digital',
                bg: 'rgba(37, 99, 235, 0.12)',
                color: 'rgb(37, 99, 235)'
            };
        }
        if (trace?.source === 'manual') {
            return {
                label: '✍️ Manual',
                bg: 'rgba(16, 185, 129, 0.12)',
                color: 'rgb(16, 185, 129)'
            };
        }
        return {
            label: '⚠️ Pendiente de revisión',
            bg: 'hsl(var(--warning) / 0.15)',
            color: 'hsl(var(--warning-foreground, 38 92% 50%))'
        };
    };

    // Validación por paso
    const validateStep = (step: number): boolean => {
        setValidationError(null);
        setBannerError(null);

        const today = getSanLuisCivilToday();
        const todayStr = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;

        // Paso 1 y Paso 2 no bloquean: siempre se puede continuar
        if (step === 3) {
            // Validación de datos personales
            if (!formData.nombre.trim()) { setValidationError("El nombre es obligatorio"); return false; }
            if (!formData.apellido.trim()) { setValidationError("El apellido es obligatorio"); return false; }
            if (!formData.dni.trim()) { setValidationError("El DNI es obligatorio"); return false; }
            
            // Fecha de nacimiento obligatoria
            if (!formData.fechaNacimiento) {
                setValidationError("La fecha de nacimiento es obligatoria");
                return false;
            }
            if (!isValidCalendarDate(formData.fechaNacimiento)) {
                setValidationError("La fecha de nacimiento es inválida (formato YYYY-MM-DD)");
                return false;
            }
            if (formData.fechaNacimiento > todayStr) {
                setValidationError("La fecha de nacimiento no puede ser una fecha futura");
                return false;
            }

            // Validación de situación REPROCANN
            const sit = formData.situacionReprocann;
            if (sit === 'vigente') {
                if (!formData.numeroTramite.trim()) {
                    setValidationError("El número de trámite REPROCANN es obligatorio para socios vigentes");
                    return false;
                }
                if (formData.fechaVencimiento) {
                    if (!isValidCalendarDate(formData.fechaVencimiento)) {
                        setValidationError("La fecha de vencimiento es inválida");
                        return false;
                    }
                    if (formData.fechaAlta && formData.fechaVencimiento < formData.fechaAlta) {
                        setValidationError("La fecha de vencimiento no puede ser anterior a la fecha de emisión");
                        return false;
                    }
                }
            } else if (sit === 'vencido') {
                if (!formData.numeroTramite.trim()) {
                    setValidationError("Debe indicar el número de trámite REPROCANN anterior");
                    return false;
                }
                if (formData.fechaVencimiento) {
                    if (!isValidCalendarDate(formData.fechaVencimiento)) {
                        setValidationError("La fecha de vencimiento es inválida");
                        return false;
                    }
                }
            } else if (sit === 'en_tramite') {
                if (!formData.numeroTramite.trim()) {
                    setValidationError("El número o código de trámite iniciado es obligatorio");
                    return false;
                }
            }
        } else if (step === 4) {
            // Cada documento adjunto debe contar con una decisión explícita (Aprobar, Dejar Pendiente, Rechazar)
            for (const doc of attachedDocs) {
                if (!doc.verificacionEstado) {
                    setValidationError(`El documento "${doc.file.name}" no cuenta con una decisión de verificación. Debés seleccionar Aprobar, Dejar Pendiente o Rechazar.`);
                    return false;
                }
                if (doc.verificacionEstado === 'rechazado' && !doc.verificacionObs.trim()) {
                    setValidationError(`El documento "${doc.file.name}" fue marcado como rechazado. Debés indicar el motivo del rechazo en las observaciones.`);
                    return false;
                }
            }
        }

        return true;
    };

    const handleNext = () => {
        if (validateStep(currentStep)) {
            setCurrentStep(prev => Math.min(prev + 1, 5));
        }
    };

    const handlePrev = () => {
        setValidationError(null);
        setBannerError(null);
        setCurrentStep(prev => Math.max(prev - 1, 1));
    };

    // Envío atómico del alta con documentos aprobados de inmediato
    const handleSubmit = async (shouldInvite = false, asDraft = false) => {
        if (!validateStep(3) || !validateStep(4)) {
            return;
        }

        setLoading(true);
        setBannerError(null);
        setBannerSuccess(null);

        try {
            // 1. Sanitización de fechas
            const finalFechaAlta = (formData.situacionReprocann === 'vigente' || formData.situacionReprocann === 'vencido') && formData.fechaAlta
                ? formData.fechaAlta
                : undefined;
            const finalFechaVencimiento = (formData.situacionReprocann === 'vigente' || formData.situacionReprocann === 'vencido') && formData.fechaVencimiento
                ? formData.fechaVencimiento
                : undefined;
            const finalNumeroTramite = formData.situacionReprocann !== 'no_posee' && formData.numeroTramite.trim()
                ? formData.numeroTramite.trim()
                : undefined;

            // 2. Crear el socio en base de datos mediante el endpoint autenticado BFF
            const newSocio = await StoreService.createSocio({
                nombre: formData.nombre.trim(),
                apellido: formData.apellido.trim(),
                dni: formData.dni.trim(),
                email: formData.email.trim().toLowerCase(),
                telefono: formData.telefono.trim(),
                direccion: formData.direccion.trim() || undefined,
                localidad: formData.localidad.trim() || undefined,
                fechaNacimiento: formData.fechaNacimiento,
                envios_habilitados: formData.enviosHabilitados,
                idempotencyKey: formData.idempotencyKey,
                rol: 'socio',
                status: asDraft ? 'draft' : 'active',
                reprocann: {
                    numeroTramite: finalNumeroTramite,
                    fechaAlta: finalFechaAlta,
                    fechaVencimiento: finalFechaVencimiento,
                    tipo: formData.situacionReprocann !== 'no_posee' ? formData.tipoVinculacion : undefined,
                    estado: formData.situacionReprocann === 'vigente' ? 'pendiente' : (formData.situacionReprocann === 'vencido' ? 'vencido' : 'pendiente')
                } as any,
                medicoNombre: formData.medicoNombre.trim() || undefined,
                medicoMatricula: formData.medicoMatricula.trim() || undefined,
                diagnosticoPrincipal: formData.diagnosticoPrincipal.trim() || undefined,
            });

            if (!newSocio?.id) {
                throw new Error("No se pudo obtener el identificador del nuevo socio registrado");
            }

            // 3. Persistir cada documento adjunto con su estado de verificación explícito
            const failedDocs: string[] = [];
            for (const doc of attachedDocs) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: doc.tipo,
                        file: doc.file,
                        fechaEmision: doc.fechaEmision || finalFechaAlta,
                        fechaVencimiento: doc.fechaVencimiento || finalFechaVencimiento,
                        numeroTramite: doc.numeroTramite || finalNumeroTramite,
                        verificacionEstado: doc.verificacionEstado || 'pendiente',
                        verificacionObs: doc.verificacionObs
                    });
                } catch (docErr: any) {
                    console.warn(`Error al adjuntar documento ${doc.file.name}:`, docErr.message);
                    failedDocs.push(doc.file.name);
                }
            }

            // 4. Enviar invitación por email si fue solicitada
            if (shouldInvite && newSocio.email) {
                try {
                    await fetch(`/api/admin/socios/${newSocio.id}/invite`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (inviteErr) {
                    console.warn("No se pudo enviar el correo de activación automática:", inviteErr);
                }
            }

            // 5. Limpieza de borrador y reporte del resultado
            localStorage.removeItem(STORAGE_KEY);
            if (failedDocs.length > 0) {
                setBannerError(`Socio ${newSocio.nombre} ${newSocio.apellido} registrado, pero hubo fallos al adjuntar los siguientes documentos: ${failedDocs.join(', ')}. Podés cargarlos nuevamente desde la ficha del socio.`);
                setTimeout(() => {
                    router.push(`/admin/socios/${newSocio.id}`);
                }, 3500);
            } else {
                setBannerSuccess(`Socio ${newSocio.nombre} ${newSocio.apellido} registrado exitosamente. Documentación verificada y persistida.`);
                setTimeout(() => {
                    router.push(`/admin/socios/${newSocio.id}`);
                }, 1200);
            }

        } catch (e: any) {
            console.error("Error al registrar nuevo socio:", e);
            // Conservar el borrador ante fallos
            setBannerError(e.message || "Ocurrió un error inesperado al procesar el alta.");
        } finally {
            setLoading(false);
        }
    };

    const steps = [
        { num: 1, title: 'Documentos', icon: Upload },
        { num: 2, title: 'Lectura Asistida', icon: Sparkles },
        { num: 3, title: 'Datos del Socio', icon: User },
        { num: 4, title: 'Aprobación', icon: ShieldCheck },
        { num: 5, title: 'Confirmación', icon: Send }
    ];

    if (!isLoaded) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                <p style={{ color: 'hsl(var(--muted-foreground))' }}>Cargando asistente de alta...</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '5rem' }}>
            {/* Header y Acciones Rápidas */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'hsl(var(--muted-foreground))',
                        fontSize: '0.9rem'
                    }}
                >
                    <ArrowLeft size={18} /> Volver a socios
                </button>

                <button
                    onClick={handleClearDraft}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'hsl(var(--destructive))',
                        fontSize: '0.85rem'
                    }}
                >
                    <Trash2 size={15} /> Limpiar borrador
                </button>
            </div>

            <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Alta Inteligente y Gestión Documental
            </h1>
            <p style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '2rem', fontSize: '0.95rem' }}>
                Cargá la documentación para autocompletar la ficha con lectura asistida, revisá los datos con control humano y aprobá los documentos en una sola operación.
            </p>

            {/* Stepper Progress Bar */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '2rem',
                backgroundColor: 'hsl(var(--card))',
                padding: '1rem 1.5rem',
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--border))'
            }}>
                {steps.map(step => {
                    const Icon = step.icon;
                    const isActive = currentStep === step.num;
                    const isPassed = currentStep > step.num;

                    return (
                        <div
                            key={step.num}
                            onClick={() => {
                                if (step.num < currentStep || validateStep(currentStep)) {
                                    setCurrentStep(step.num);
                                }
                            }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                cursor: 'pointer',
                                opacity: isActive ? 1 : (isPassed ? 0.85 : 0.5),
                                color: isActive ? 'hsl(var(--primary))' : 'inherit',
                                fontWeight: isActive ? 600 : 500
                            }}
                        >
                            <div style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.8rem',
                                backgroundColor: isPassed ? 'hsl(var(--primary))' : (isActive ? 'hsl(var(--primary) / 0.15)' : 'hsl(var(--muted))'),
                                color: isPassed ? 'hsl(var(--primary-foreground))' : (isActive ? 'hsl(var(--primary))' : 'inherit')
                            }}>
                                {isPassed ? <Check size={16} /> : <Icon size={14} />}
                            </div>
                            <span style={{ fontSize: '0.85rem' }} className="hidden md:inline">
                                {step.title}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Banners de validación o error */}
            {validationError && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.75rem 1rem',
                    marginBottom: '1.5rem',
                    borderRadius: 'var(--radius)',
                    backgroundColor: 'hsl(var(--destructive) / 0.1)',
                    color: 'hsl(var(--destructive))',
                    border: '1px solid hsl(var(--destructive) / 0.3)',
                    fontSize: '0.9rem'
                }}>
                    <AlertCircle size={18} />
                    <span>{validationError}</span>
                </div>
            )}

            {bannerError && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.75rem 1rem',
                    marginBottom: '1.5rem',
                    borderRadius: 'var(--radius)',
                    backgroundColor: 'hsl(var(--warning) / 0.15)',
                    color: 'hsl(var(--warning-foreground, 38 92% 50%))',
                    border: '1px solid hsl(var(--warning) / 0.4)',
                    fontSize: '0.9rem'
                }}>
                    <AlertCircle size={18} />
                    <span>{bannerError}</span>
                </div>
            )}

            {bannerSuccess && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.75rem 1rem',
                    marginBottom: '1.5rem',
                    borderRadius: 'var(--radius)',
                    backgroundColor: 'hsl(var(--success, 142 76% 36%) / 0.15)',
                    color: 'hsl(var(--success, 142 76% 36%))',
                    border: '1px solid hsl(var(--success, 142 76% 36%) / 0.4)',
                    fontSize: '0.9rem'
                }}>
                    <CheckCircle size={18} />
                    <span>{bannerSuccess}</span>
                </div>
            )}

            {/* Contenedor Principal del Wizard */}
            <div style={{
                backgroundColor: 'hsl(var(--card))',
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--border))',
                padding: '2rem',
                boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
            }}>

                {/* ========================================================
                    PASO 1: DOCUMENTACIÓN INICIAL
                   ======================================================== */}
                {currentStep === 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                                Paso 1: Carga de Documentación Inicial
                            </h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                                Adjuntá el Certificado REPROCANN, consentimiento informado o constancia de trámite para autocompletar la ficha.
                            </p>
                        </div>

                        {/* Zona Drag & Drop / Input */}
                        <div style={{
                            border: '2px dashed hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                            padding: '2.5rem 1.5rem',
                            textAlign: 'center',
                            backgroundColor: 'hsl(var(--muted) / 0.2)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '1rem'
                        }}>
                            <div style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '50%',
                                backgroundColor: 'hsl(var(--primary) / 0.1)',
                                color: 'hsl(var(--primary))',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <Upload size={28} />
                            </div>

                            <div>
                                <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.3rem' }}>
                                    Seleccioná o arrastrá el certificado digital o consentimiento
                                </p>
                                <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                                    Formatos admitidos: PDF, JPG, PNG (hasta 15MB)
                                </p>
                            </div>

                            <label style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.6rem 1.2rem',
                                backgroundColor: 'hsl(var(--primary))',
                                color: 'hsl(var(--primary-foreground))',
                                borderRadius: 'var(--radius)',
                                fontWeight: 600,
                                fontSize: '0.9rem',
                                cursor: 'pointer'
                            }}>
                                <FileUp size={16} /> Seleccionar Archivo
                                <input
                                    type="file"
                                    multiple
                                    accept=".pdf,image/jpeg,image/png,image/webp"
                                    onChange={(e) => handleFileSelect(e, 'reprocann')}
                                    style={{ display: 'none' }}
                                />
                            </label>

                            {isExtracting && (
                                <p style={{ color: 'hsl(var(--primary))', fontSize: '0.85rem', fontWeight: 500 }}>
                                    Procesando lectura asistida del documento...
                                </p>
                            )}
                        </div>

                        {/* Documentos seleccionados actualmente */}
                        {attachedDocs.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>
                                    Documentos adjuntos ({attachedDocs.length})
                                </label>
                                {attachedDocs.map((doc) => (
                                    <div key={doc.id} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '0.75rem 1rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--border))',
                                        backgroundColor: 'hsl(var(--card))'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <FileText size={20} style={{ color: 'hsl(var(--primary))' }} />
                                            <div>
                                                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{doc.file.name}</p>
                                                <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.75rem' }}>
                                                    {(doc.file.size / 1024).toFixed(1)} KB • Tipo: {doc.tipo}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveDoc(doc.id)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: 'hsl(var(--destructive))',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Opción destacada: Continuar sin documento */}
                        <div style={{
                            padding: '1.25rem',
                            borderRadius: 'var(--radius)',
                            border: '1px solid hsl(var(--border))',
                            backgroundColor: 'hsl(var(--muted) / 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            marginTop: '0.5rem'
                        }}>
                            <div>
                                <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>¿La persona todavía no inició el trámite?</h3>
                                <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                                    Podés dar de alta un socio o aspirante sin documentación para completar sus datos personales y regularizarlo más adelante.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    handleChange('situacionReprocann', 'no_posee');
                                    setCurrentStep(3);
                                }}
                                style={{
                                    padding: '0.6rem 1rem',
                                    backgroundColor: 'hsl(var(--secondary))',
                                    color: 'hsl(var(--secondary-foreground))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    fontWeight: 500,
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Continuar sin documento →
                            </button>
                        </div>
                    </div>
                )}

                {/* ========================================================
                    PASO 2: LECTURA ASISTIDA Y RESULTADOS MULTI-DOCUMENTO
                   ======================================================== */}
                {currentStep === 2 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                                Paso 2: Lectura Asistida y Desglose Documental
                            </h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                                Revisá el análisis por archivo y la propuesta consolidada antes de continuar. La validación humana es obligatoria.
                            </p>
                        </div>

                        {/* Alerta de Conflictos / Discrepancias entre documentos si las hubiere */}
                        {conflicts.length > 0 && (
                            <div style={{
                                padding: '1rem',
                                borderRadius: 'var(--radius)',
                                backgroundColor: 'hsl(var(--destructive) / 0.1)',
                                border: '1px solid hsl(var(--destructive) / 0.4)',
                                color: 'hsl(var(--destructive))'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                                    <AlertCircle size={18} />
                                    <span>Discrepancia detectada entre documentos adjuntos ({conflicts.length})</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                                    {conflicts.map((conf, idx) => (
                                        <div key={idx} style={{
                                            padding: '0.5rem 0.75rem',
                                            backgroundColor: 'hsl(var(--card))',
                                            borderRadius: '6px',
                                            border: '1px solid hsl(var(--border))',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            gap: '0.5rem'
                                        }}>
                                            <div>
                                                <strong>{conf.label}:</strong>
                                                <span style={{ marginLeft: '0.5rem', color: 'hsl(var(--foreground))' }}>
                                                    "{conf.valueA}" ({conf.fileA}) ≠ "{conf.valueB}" ({conf.fileB})
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleChange(conf.field as keyof FormData, conf.valueA)}
                                                    style={{
                                                        fontSize: '0.75rem',
                                                        padding: '0.25rem 0.6rem',
                                                        borderRadius: '4px',
                                                        border: '1px solid hsl(var(--border))',
                                                        backgroundColor: formData[conf.field as keyof FormData] === conf.valueA ? 'hsl(var(--primary))' : 'hsl(var(--secondary))',
                                                        color: formData[conf.field as keyof FormData] === conf.valueA ? 'hsl(var(--primary-foreground))' : 'hsl(var(--secondary-foreground))',
                                                        cursor: 'pointer',
                                                        fontWeight: 500
                                                    }}
                                                >
                                                    Usar {conf.valueA}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleChange(conf.field as keyof FormData, conf.valueB)}
                                                    style={{
                                                        fontSize: '0.75rem',
                                                        padding: '0.25rem 0.6rem',
                                                        borderRadius: '4px',
                                                        border: '1px solid hsl(var(--border))',
                                                        backgroundColor: formData[conf.field as keyof FormData] === conf.valueB ? 'hsl(var(--primary))' : 'hsl(var(--secondary))',
                                                        color: formData[conf.field as keyof FormData] === conf.valueB ? 'hsl(var(--primary-foreground))' : 'hsl(var(--secondary-foreground))',
                                                        cursor: 'pointer',
                                                        fontWeight: 500
                                                    }}
                                                >
                                                    Usar {conf.valueB}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Desglose Documento por Documento */}
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={18} style={{ color: 'hsl(var(--primary))' }} />
                                Documentos analizados ({attachedDocs.length})
                            </h3>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {attachedDocs.map((doc, idx) => {
                                    const ext = doc.extraction;
                                    const isImageOnly = ext?.requiresVisualOcr || ext?.hasImageOnlyLayer;
                                    const isSuccess = ext?.isLegible && !isImageOnly;

                                    return (
                                        <div key={doc.id || idx} style={{
                                            padding: '1rem 1.25rem',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: 'var(--radius)',
                                            backgroundColor: 'hsl(var(--card))'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>{doc.file.name}</p>
                                                        <span style={{
                                                            padding: '0.15rem 0.5rem',
                                                            borderRadius: '9999px',
                                                            fontSize: '0.75rem',
                                                            backgroundColor: 'hsl(var(--secondary))',
                                                            textTransform: 'uppercase',
                                                            fontWeight: 600
                                                        }}>
                                                            {ext?.documentType || doc.tipo}
                                                        </span>
                                                    </div>
                                                    <p style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))', marginTop: '0.2rem' }}>
                                                        {ext?.totalPages || 1} página(s) • {(doc.file.size / 1024).toFixed(1)} KB • {ext?.sourceDescription || 'Extracción local'}
                                                    </p>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    {ext?.extractionSource === 'agent_core_gemini' ? (
                                                        <span style={{
                                                            padding: '0.25rem 0.65rem',
                                                            borderRadius: '9999px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 600,
                                                            backgroundColor: 'rgba(124, 58, 237, 0.15)',
                                                            color: 'rgb(124, 58, 237)',
                                                            border: '1px solid rgba(124, 58, 237, 0.3)'
                                                        }}>
                                                            🤖 Gemini Vision (Agent Core - {Math.round((ext.confidence?.overall || 0.9) * 100)}%)
                                                        </span>
                                                    ) : isSuccess ? (
                                                        <span style={{
                                                            padding: '0.25rem 0.6rem',
                                                            borderRadius: '9999px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 600,
                                                            backgroundColor: 'hsl(var(--success, 142 76% 36%) / 0.15)',
                                                            color: 'hsl(var(--success, 142 76% 36%))'
                                                        }}>
                                                            ✓ Capa de texto digital ({ext?.detectedFieldsCount || 0} campos)
                                                        </span>
                                                    ) : isImageOnly ? (
                                                        <span style={{
                                                            padding: '0.25rem 0.6rem',
                                                            borderRadius: '9999px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 600,
                                                            backgroundColor: 'hsl(var(--warning) / 0.15)',
                                                            color: 'hsl(var(--warning-foreground, 38 92% 50%))'
                                                        }}>
                                                            ⚠️ Imagen rasterizada (Entrada asistida)
                                                        </span>
                                                    ) : (
                                                        <span style={{
                                                            padding: '0.25rem 0.6rem',
                                                            borderRadius: '9999px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 500,
                                                            backgroundColor: 'hsl(var(--muted))',
                                                            color: 'hsl(var(--muted-foreground))'
                                                        }}>
                                                            Sin datos de texto legibles
                                                        </span>
                                                    )}

                                                    {/* Botón Reintentar con Gemini si el documento no fue procesado por Gemini */}
                                                    {ext?.extractionSource !== 'agent_core_gemini' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRetryDocumentWithGemini(doc.id)}
                                                            disabled={isRetryingDocId !== null}
                                                            title="Reintentar análisis documental inteligente con Gemini Vision (Agent Core)"
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '0.35rem',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 600,
                                                                padding: '0.25rem 0.65rem',
                                                                borderRadius: '6px',
                                                                backgroundColor: isRetryingDocId === doc.id ? 'rgba(124, 58, 237, 0.2)' : 'rgba(124, 58, 237, 0.1)',
                                                                color: 'rgb(124, 58, 237)',
                                                                border: '1px solid rgba(124, 58, 237, 0.3)',
                                                                cursor: isRetryingDocId !== null ? 'wait' : 'pointer'
                                                            }}
                                                        >
                                                            <RefreshCw size={13} className={isRetryingDocId === doc.id ? 'animate-spin' : ''} />
                                                            {isRetryingDocId === doc.id ? 'Analizando con Gemini...' : 'Reintentar análisis con Gemini'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Razón de fallo o advertencia de disponibilidad de Gemini */}
                                            {ext?.failureReason && (
                                                <div style={{
                                                    fontSize: '0.75rem',
                                                    padding: '0.35rem 0.65rem',
                                                    borderRadius: '4px',
                                                    backgroundColor: 'hsl(var(--muted) / 0.6)',
                                                    color: 'hsl(var(--foreground))',
                                                    marginBottom: '0.6rem',
                                                    borderLeft: '3px solid hsl(var(--primary))'
                                                }}>
                                                    ℹ️ <strong>Estado del análisis:</strong> {ext.failureReason}
                                                </div>
                                            )}

                                            {/* Campos detectados en este documento */}
                                            {ext && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    {ext.titular?.nombre && (
                                                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'hsl(var(--muted) / 0.5)', borderRadius: '4px' }}>
                                                            <strong>Titular:</strong> {ext.titular.nombre} {ext.titular.apellido || ''}
                                                        </span>
                                                    )}
                                                    {ext.dni && (
                                                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'hsl(var(--muted) / 0.5)', borderRadius: '4px' }}>
                                                            <strong>DNI:</strong> {ext.dni}
                                                        </span>
                                                    )}
                                                    {ext.fechaNacimiento && (
                                                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'hsl(var(--muted) / 0.5)', borderRadius: '4px' }}>
                                                            <strong>Nacimiento:</strong> {formatCalendarDate(ext.fechaNacimiento)}
                                                        </span>
                                                    )}
                                                    {ext.numeroTramite && (
                                                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'hsl(var(--muted) / 0.5)', borderRadius: '4px' }}>
                                                            <strong>Trámite:</strong> {ext.numeroTramite}
                                                        </span>
                                                    )}
                                                    {ext.medico?.nombre && (
                                                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'hsl(var(--muted) / 0.5)', borderRadius: '4px' }}>
                                                            <strong>Médico:</strong> {ext.medico.nombre} {ext.medico.matricula ? `(${ext.medico.matricula})` : ''}
                                                        </span>
                                                    )}
                                                    {ext.diagnostico && (
                                                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'hsl(var(--muted) / 0.5)', borderRadius: '4px' }}>
                                                            <strong>Diagnóstico:</strong> {ext.diagnostico}
                                                        </span>
                                                    )}
                                                    {ext.fechaVencimiento && (
                                                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'hsl(var(--muted) / 0.5)', borderRadius: '4px' }}>
                                                            <strong>Vencimiento:</strong> {formatCalendarDate(ext.fechaVencimiento)}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {/* Advertencias específicas del archivo */}
                                            {ext?.warnings && ext.warnings.length > 0 && (
                                                <div style={{ fontSize: '0.8rem', color: 'hsl(var(--warning-foreground, 38 92% 50%))', backgroundColor: 'hsl(var(--warning) / 0.08)', padding: '0.5rem 0.75rem', borderRadius: '4px', marginTop: '0.5rem' }}>
                                                    {ext.warnings.map((w, wIdx) => (
                                                        <div key={wIdx}>• {w}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Cuadrícula de Datos Consolidados (Propuesta a aplicar en Paso 3) */}
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Sparkles size={18} style={{ color: 'hsl(var(--primary))' }} />
                                Propuesta Consolidada para Ficha del Socio
                            </h3>

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                                gap: '1rem'
                            }}>
                                {/* 1. Titular */}
                                {(() => {
                                    const titularVal = (formData.nombre || formData.apellido) 
                                        ? `${formData.nombre} ${formData.apellido}`.trim() 
                                        : '';
                                    const pill = getFieldProvenancePill('titular', titularVal, fieldTraceability.nombre || fieldTraceability.apellido);
                                    return (
                                        <div style={{ padding: '0.75rem 1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Titular Propuesto</span>
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600, backgroundColor: pill.bg, color: pill.color }}>
                                                    {pill.label}
                                                </span>
                                            </div>
                                            <p style={{ fontWeight: 600 }}>{titularVal || 'No detectado'}</p>
                                        </div>
                                    );
                                })()}

                                {/* 2. DNI */}
                                {(() => {
                                    const pill = getFieldProvenancePill('dni', formData.dni, fieldTraceability.dni);
                                    return (
                                        <div style={{ padding: '0.75rem 1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>DNI Propuesto</span>
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600, backgroundColor: pill.bg, color: pill.color }}>
                                                    {pill.label}
                                                </span>
                                            </div>
                                            <p style={{ fontWeight: 600 }}>{formData.dni || 'No detectado'}</p>
                                        </div>
                                    );
                                })()}

                                {/* 3. Fecha de Nacimiento */}
                                {(() => {
                                    const pill = getFieldProvenancePill('fechaNacimiento', formData.fechaNacimiento, fieldTraceability.fechaNacimiento);
                                    return (
                                        <div style={{ padding: '0.75rem 1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Fecha de Nacimiento</span>
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600, backgroundColor: pill.bg, color: pill.color }}>
                                                    {pill.label}
                                                </span>
                                            </div>
                                            <p style={{ fontWeight: 600 }}>
                                                {formData.fechaNacimiento ? formatCalendarDate(formData.fechaNacimiento) : 'No detectada'}
                                            </p>
                                        </div>
                                    );
                                })()}

                                {/* 4. N° Trámite REPROCANN */}
                                {(() => {
                                    const pill = getFieldProvenancePill('numeroTramite', formData.numeroTramite, fieldTraceability.numeroTramite);
                                    return (
                                        <div style={{ padding: '0.75rem 1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>N° Trámite REPROCANN</span>
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600, backgroundColor: pill.bg, color: pill.color }}>
                                                    {pill.label}
                                                </span>
                                            </div>
                                            <p style={{ fontWeight: 600 }}>{formData.numeroTramite || 'No detectado'}</p>
                                        </div>
                                    );
                                })()}

                                {/* 5. Vencimiento REPROCANN */}
                                {(() => {
                                    const pill = getFieldProvenancePill('fechaVencimiento', formData.fechaVencimiento, fieldTraceability.fechaVencimiento);
                                    return (
                                        <div style={{ padding: '0.75rem 1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Vencimiento REPROCANN</span>
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600, backgroundColor: pill.bg, color: pill.color }}>
                                                    {pill.label}
                                                </span>
                                            </div>
                                            <p style={{ fontWeight: 600 }}>
                                                {formData.fechaVencimiento 
                                                    ? formatCalendarDate(formData.fechaVencimiento) 
                                                    : 'No detectado (completar manualmente si posee credencial vigente)'}
                                            </p>
                                        </div>
                                    );
                                })()}

                                {/* 6. Médico Tratante */}
                                {(() => {
                                    const pill = getFieldProvenancePill('medicoNombre', formData.medicoNombre, fieldTraceability.medicoNombre);
                                    return (
                                        <div style={{ padding: '0.75rem 1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Médico Tratante</span>
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600, backgroundColor: pill.bg, color: pill.color }}>
                                                    {pill.label}
                                                </span>
                                            </div>
                                            <p style={{ fontWeight: 600 }}>
                                                {formData.medicoNombre 
                                                    ? `${formData.medicoNombre} ${formData.medicoMatricula ? `(Mat: ${formData.medicoMatricula})` : ''}` 
                                                    : 'Pendiente de revisión médica'}
                                            </p>
                                        </div>
                                    );
                                })()}

                                {/* 7. Diagnóstico / Patología */}
                                {(() => {
                                    const pill = getFieldProvenancePill('diagnosticoPrincipal', formData.diagnosticoPrincipal, fieldTraceability.diagnosticoPrincipal);
                                    return (
                                        <div style={{ padding: '0.75rem 1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Diagnóstico / Patología</span>
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600, backgroundColor: pill.bg, color: pill.color }}>
                                                    {pill.label}
                                                </span>
                                            </div>
                                            <p style={{ fontWeight: 600 }}>
                                                {formData.diagnosticoPrincipal || 'Pendiente de revisión clínica'}
                                            </p>
                                            {!formData.diagnosticoPrincipal && (
                                                <span style={{ fontSize: '0.7rem', color: 'hsl(var(--muted-foreground))' }}>
                                                    No inferido desde texto plano para preservar integridad clínica. Completar en Paso 3 o reintentar con Gemini.
                                                </span>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Botón rápido para volver y agregar más documentos */}
                        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                            <button
                                type="button"
                                onClick={() => setCurrentStep(1)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.5rem 0.9rem',
                                    backgroundColor: 'hsl(var(--secondary))',
                                    color: 'hsl(var(--secondary-foreground))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer'
                                }}
                            >
                                <FileUp size={15} /> Adjuntar más documentos en Paso 1
                            </button>
                        </div>
                    </div>
                )}

                {/* ========================================================
                    PASO 3: REVISIÓN Y CONFIRMACIÓN DE DATOS
                   ======================================================== */}
                {currentStep === 3 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                                Paso 3: Revisión y Confirmación de Datos
                            </h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                                Verificá o completá la información del socio. Los valores extraídos se indican con una etiqueta informativa.
                            </p>
                        </div>

                        {/* Sección 1: Datos Personales */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                                1. Identificación y Contacto
                            </h3>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Nombre *
                                        {formData.camposExtraidos?.includes('nombre') && (
                                            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'hsl(var(--primary))' }}>[Extraído]</span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.nombre}
                                        onChange={(e) => handleChange('nombre', e.target.value)}
                                        placeholder="Ej. Juan"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Apellido *
                                        {formData.camposExtraidos?.includes('apellido') && (
                                            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'hsl(var(--primary))' }}>[Extraído]</span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.apellido}
                                        onChange={(e) => handleChange('apellido', e.target.value)}
                                        placeholder="Ej. Pérez"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        DNI *
                                        {formData.camposExtraidos?.includes('dni') && (
                                            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'hsl(var(--primary))' }}>[Extraído]</span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.dni}
                                        onChange={(e) => handleChange('dni', e.target.value)}
                                        placeholder="Solo números (sin puntos)"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Fecha de Nacimiento *
                                        {formData.camposExtraidos?.includes('fechaNacimiento') && (
                                            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'hsl(var(--primary))' }}>[Extraído]</span>
                                        )}
                                    </label>
                                    <input
                                        type="date"
                                        value={formData.fechaNacimiento}
                                        onChange={(e) => handleChange('fechaNacimiento', e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Correo Electrónico
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => handleChange('email', e.target.value)}
                                        placeholder="socio@ejemplo.com"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Teléfono / WhatsApp
                                    </label>
                                    <input
                                        type="tel"
                                        value={formData.telefono}
                                        onChange={(e) => handleChange('telefono', e.target.value)}
                                        placeholder="Ej. +54 9 266 4123456"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Domicilio
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.direccion}
                                        onChange={(e) => handleChange('direccion', e.target.value)}
                                        placeholder="Calle y número"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Localidad
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.localidad}
                                        onChange={(e) => handleChange('localidad', e.target.value)}
                                        placeholder="San Luis / Merlo"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Delivery habilitado por defecto */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.75rem 1rem',
                                borderRadius: 'var(--radius)',
                                backgroundColor: 'hsl(var(--muted) / 0.15)',
                                border: '1px solid hsl(var(--border))'
                            }}>
                                <input
                                    type="checkbox"
                                    id="enviosHabilitados"
                                    checked={formData.enviosHabilitados}
                                    onChange={(e) => handleChange('enviosHabilitados', e.target.checked)}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                />
                                <label htmlFor="enviosHabilitados" style={{ fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Truck size={16} /> <strong>Habilitar servicio de delivery / envíos</strong> (activado por defecto)
                                </label>
                            </div>
                        </div>

                        {/* Sección 2: Situación REPROCANN */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                                2. Situación Regulatoria REPROCANN
                            </h3>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                                {[
                                    { id: 'vigente', label: 'Vigente' },
                                    { id: 'vencido', label: 'Vencido' },
                                    { id: 'en_tramite', label: 'En Trámite' },
                                    { id: 'no_posee', label: 'No Posee' }
                                ].map(opt => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => handleChange('situacionReprocann', opt.id)}
                                        style={{
                                            padding: '0.6rem 0.4rem',
                                            borderRadius: 'var(--radius)',
                                            border: formData.situacionReprocann === opt.id 
                                                ? '2px solid hsl(var(--primary))' 
                                                : '1px solid hsl(var(--border))',
                                            backgroundColor: formData.situacionReprocann === opt.id 
                                                ? 'hsl(var(--primary) / 0.1)' 
                                                : 'hsl(var(--card))',
                                            color: formData.situacionReprocann === opt.id 
                                                ? 'hsl(var(--primary))' 
                                                : 'inherit',
                                            fontWeight: formData.situacionReprocann === opt.id ? 600 : 400,
                                            fontSize: '0.85rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                            {formData.situacionReprocann !== 'no_posee' && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                            N° de Trámite *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.numeroTramite}
                                            onChange={(e) => handleChange('numeroTramite', e.target.value)}
                                            placeholder="Código o número"
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--border))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                            Fecha de Emisión
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.fechaAlta}
                                            onChange={(e) => handleChange('fechaAlta', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--border))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                            Fecha de Vencimiento
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.fechaVencimiento}
                                            onChange={(e) => handleChange('fechaVencimiento', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--border))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sección 3: Información Médica */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                                3. Información Médica
                            </h3>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Médico Tratante
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.medicoNombre}
                                        onChange={(e) => handleChange('medicoNombre', e.target.value)}
                                        placeholder="Nombre y apellido del profesional"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                        Matrícula Profesional
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.medicoMatricula}
                                        onChange={(e) => handleChange('medicoMatricula', e.target.value)}
                                        placeholder="M.N. o M.P."
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem 0.8rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            backgroundColor: 'hsl(var(--background))'
                                        }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                                    Diagnóstico / Indicación Clínica
                                </label>
                                <input
                                    type="text"
                                    value={formData.diagnosticoPrincipal}
                                    onChange={(e) => handleChange('diagnosticoPrincipal', e.target.value)}
                                    placeholder="Patología o motivo de prescripción"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--border))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ========================================================
                    PASO 4: REVISIÓN Y APROBACIÓN DOCUMENTAL
                   ======================================================== */}
                {currentStep === 4 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                                Paso 4: Revisión y Aprobación Documental
                            </h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                                Como administrador, revisá y aprobá los documentos antes de confirmar el alta. Los documentos aprobados quedarán en estado <strong>APROBADO</strong> inmediatamente.
                            </p>
                        </div>

                        {attachedDocs.length === 0 ? (
                            <div style={{
                                padding: '2rem',
                                textAlign: 'center',
                                border: '1px dashed hsl(var(--border))',
                                borderRadius: 'var(--radius)',
                                color: 'hsl(var(--muted-foreground))'
                            }}>
                                <FileText size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                                <p>No se adjuntaron documentos para este socio.</p>
                                <p style={{ fontSize: '0.8rem' }}>Podés continuar al resumen para confirmar el alta.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                {attachedDocs.map((doc, idx) => (
                                    <div key={doc.id} style={{
                                        border: '1px solid hsl(var(--border))',
                                        borderRadius: 'var(--radius)',
                                        padding: '1.25rem',
                                        backgroundColor: 'hsl(var(--card))',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '1rem'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <FileCheck size={24} style={{ color: doc.verificacionEstado === 'aprobado' ? 'hsl(var(--success, 142 76% 36%))' : 'hsl(var(--primary))' }} />
                                                <div>
                                                    <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>{doc.file.name}</p>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                                                        <span style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>
                                                            Tipo: <strong>{doc.tipo}</strong> • {(doc.file.size / 1024).toFixed(1)} KB
                                                        </span>
                                                        <span style={{
                                                            fontSize: '0.75rem',
                                                            fontWeight: 600,
                                                            padding: '0.15rem 0.5rem',
                                                            borderRadius: '9999px',
                                                            backgroundColor: doc.verificacionEstado === 'aprobado'
                                                                ? 'hsl(var(--success, 142 76% 36%) / 0.15)'
                                                                : doc.verificacionEstado === 'pendiente'
                                                                    ? 'hsl(var(--warning, 38 92% 50%) / 0.15)'
                                                                    : doc.verificacionEstado === 'rechazado'
                                                                        ? 'hsl(var(--destructive) / 0.15)'
                                                                        : 'hsl(var(--muted))',
                                                            color: doc.verificacionEstado === 'aprobado'
                                                                ? 'hsl(var(--success, 142 76% 36%))'
                                                                : doc.verificacionEstado === 'pendiente'
                                                                    ? 'hsl(var(--warning-foreground, 38 92% 50%))'
                                                                    : doc.verificacionEstado === 'rechazado'
                                                                        ? 'hsl(var(--destructive))'
                                                                        : 'hsl(var(--muted-foreground))'
                                                        }}>
                                                            {doc.verificacionEstado === 'aprobado' && '✅ Aprobado'}
                                                            {doc.verificacionEstado === 'pendiente' && '⏳ Pendiente'}
                                                            {doc.verificacionEstado === 'rechazado' && '❌ Rechazado'}
                                                            {!doc.verificacionEstado && '⚠️ Sin decisión requerida'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Acciones: Ver documento y Selector de estado de verificación */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {/* Botón Ver Documento Seguro (URL.createObjectURL efímera) */}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const isPdf = doc.file.type === 'application/pdf' || doc.file.name.toLowerCase().endsWith('.pdf');
                                                        const url = URL.createObjectURL(doc.file);
                                                        setPreviewDoc({ name: doc.file.name, url, isPdf });
                                                    }}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                        padding: '0.4rem 0.75rem',
                                                        borderRadius: 'var(--radius)',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        border: '1px solid hsl(var(--border))',
                                                        backgroundColor: 'hsl(var(--secondary))',
                                                        color: 'hsl(var(--secondary-foreground))'
                                                    }}
                                                >
                                                    <Eye size={14} /> Ver documento
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAttachedDocs(prev => prev.map((d, i) => i === idx ? { ...d, verificacionEstado: 'aprobado' } : d));
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.3rem',
                                                        padding: '0.4rem 0.8rem',
                                                        borderRadius: 'var(--radius)',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        border: doc.verificacionEstado === 'aprobado' ? '2px solid hsl(var(--success, 142 76% 36%))' : '1px solid hsl(var(--border))',
                                                        backgroundColor: doc.verificacionEstado === 'aprobado' ? 'hsl(var(--success, 142 76% 36%) / 0.15)' : 'hsl(var(--background))',
                                                        color: doc.verificacionEstado === 'aprobado' ? 'hsl(var(--success, 142 76% 36%))' : 'inherit'
                                                    }}
                                                >
                                                    <CheckCircle size={14} /> Aprobar
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAttachedDocs(prev => prev.map((d, i) => i === idx ? { ...d, verificacionEstado: 'pendiente' } : d));
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.3rem',
                                                        padding: '0.4rem 0.8rem',
                                                        borderRadius: 'var(--radius)',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        border: doc.verificacionEstado === 'pendiente' ? '2px solid hsl(var(--warning, 38 92% 50%))' : '1px solid hsl(var(--border))',
                                                        backgroundColor: doc.verificacionEstado === 'pendiente' ? 'hsl(var(--warning, 38 92% 50%) / 0.15)' : 'hsl(var(--background))',
                                                        color: doc.verificacionEstado === 'pendiente' ? 'hsl(var(--warning, 38 92% 50%))' : 'inherit'
                                                    }}
                                                >
                                                    <Clock size={14} /> Dejar Pendiente
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAttachedDocs(prev => prev.map((d, i) => i === idx ? { ...d, verificacionEstado: 'rechazado' } : d));
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.3rem',
                                                        padding: '0.4rem 0.8rem',
                                                        borderRadius: 'var(--radius)',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        border: doc.verificacionEstado === 'rechazado' ? '2px solid hsl(var(--destructive))' : '1px solid hsl(var(--border))',
                                                        backgroundColor: doc.verificacionEstado === 'rechazado' ? 'hsl(var(--destructive) / 0.15)' : 'hsl(var(--background))',
                                                        color: doc.verificacionEstado === 'rechazado' ? 'hsl(var(--destructive))' : 'inherit'
                                                    }}
                                                >
                                                    <XCircle size={14} /> Rechazar
                                                </button>
                                            </div>
                                        </div>

                                        {/* Observaciones de verificación (obligatorio si es rechazado) */}
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>
                                                {doc.verificacionEstado === 'rechazado' ? 'Motivo del rechazo *' : 'Observaciones administrativas de verificación'}
                                            </label>
                                            <input
                                                type="text"
                                                value={doc.verificacionObs}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setAttachedDocs(prev => prev.map((d, i) => i === idx ? { ...d, verificacionObs: val } : d));
                                                }}
                                                placeholder={doc.verificacionEstado === 'rechazado' ? 'Indicar motivo por el cual se rechaza el documento' : 'Opcional'}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.5rem 0.8rem',
                                                    borderRadius: 'var(--radius)',
                                                    border: '1px solid hsl(var(--border))',
                                                    backgroundColor: 'hsl(var(--background))',
                                                    fontSize: '0.85rem'
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Nota institucional de separación entre verificación documental y admisión estatutaria */}
                        <div style={{
                            padding: '0.85rem 1rem',
                            borderRadius: 'var(--radius)',
                            backgroundColor: 'hsl(var(--muted) / 0.25)',
                            border: '1px solid hsl(var(--border))',
                            fontSize: '0.82rem',
                            color: 'hsl(var(--muted-foreground))',
                            marginTop: '0.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            <Info size={16} style={{ color: 'hsl(var(--primary))', flexShrink: 0 }} />
                            <span>
                                <strong>Nota institucional:</strong> La verificación y aprobación administrativa de la documentación no equivale a la admisión definitiva del socio por la Comisión Directiva de la Asociación, ni habilita por sí misma la dispensa institucional.
                            </span>
                        </div>
                    </div>
                )}

                {/* ========================================================
                    PASO 5: RESUMEN Y CONFIRMACIÓN
                   ======================================================== */}
                {currentStep === 5 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                                Paso 5: Resumen y Confirmación de Alta
                            </h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                                Revisá los datos finales antes de registrar al socio. Los documentos aprobados quedarán vigentes de inmediato.
                            </p>
                        </div>

                        {/* Ficha Resumen Socio */}
                        <div style={{
                            padding: '1.25rem',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                            backgroundColor: 'hsl(var(--card))',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: '1rem'
                        }}>
                            <div>
                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Socio</span>
                                <p style={{ fontWeight: 600 }}>{formData.nombre} {formData.apellido}</p>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>DNI</span>
                                <p style={{ fontWeight: 600 }}>{formData.dni}</p>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Fecha de Nacimiento</span>
                                <p style={{ fontWeight: 600 }}>{formatCalendarDate(formData.fechaNacimiento)}</p>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Situación REPROCANN</span>
                                <p style={{ fontWeight: 600, textTransform: 'capitalize' }}>{formData.situacionReprocann.replace('_', ' ')}</p>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Delivery / Envíos</span>
                                <p style={{ fontWeight: 600 }}>{formData.enviosHabilitados ? 'Habilitado' : 'Deshabilitado'}</p>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Email</span>
                                <p style={{ fontWeight: 600 }}>{formData.email || '-'}</p>
                            </div>
                        </div>

                        {/* Resumen de Documentos y Estados de Aprobación */}
                        <div>
                            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                                Documentación a Registrar ({attachedDocs.length})
                            </h3>
                            {attachedDocs.length === 0 ? (
                                <p style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>Sin documentos adjuntos.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {attachedDocs.map(doc => (
                                        <div key={doc.id} style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '0.6rem 1rem',
                                            borderRadius: 'var(--radius)',
                                            border: '1px solid hsl(var(--border))',
                                            fontSize: '0.85rem'
                                        }}>
                                            <span><strong>{doc.file.name}</strong> ({doc.tipo})</span>
                                            <span style={{
                                                padding: '0.2rem 0.6rem',
                                                borderRadius: '9999px',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                backgroundColor: doc.verificacionEstado === 'aprobado' ? 'hsl(var(--success, 142 76% 36%) / 0.15)' : 'hsl(var(--muted))',
                                                color: doc.verificacionEstado === 'aprobado' ? 'hsl(var(--success, 142 76% 36%))' : 'inherit'
                                            }}>
                                                {doc.verificacionEstado === 'aprobado' ? '✓ APROBADO' : (doc.verificacionEstado === 'rechazado' ? '✕ RECHAZADO' : '⏳ PENDIENTE')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Botones de Confirmación Final */}
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '1rem',
                            marginTop: '1.5rem',
                            paddingTop: '1.5rem',
                            borderTop: '1px solid hsl(var(--border))'
                        }}>
                            <button
                                type="button"
                                disabled={loading}
                                onClick={() => handleSubmit(false, false)}
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    padding: '0.8rem 1.5rem',
                                    backgroundColor: 'hsl(var(--primary))',
                                    color: 'hsl(var(--primary-foreground))',
                                    borderRadius: 'var(--radius)',
                                    fontWeight: 600,
                                    fontSize: '0.95rem',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    border: 'none'
                                }}
                            >
                                <Save size={18} />
                                {loading ? 'Registrando y Verificando...' : 'Confirmar Alta y Guardar'}
                            </button>

                            {formData.email && (
                                <button
                                    type="button"
                                    disabled={loading}
                                    onClick={() => handleSubmit(true, false)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.8rem 1.5rem',
                                        backgroundColor: 'hsl(var(--secondary))',
                                        color: 'hsl(var(--secondary-foreground))',
                                        borderRadius: 'var(--radius)',
                                        fontWeight: 600,
                                        fontSize: '0.95rem',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        border: '1px solid hsl(var(--border))'
                                    }}
                                >
                                    <Send size={18} />
                                    Confirmar y Enviar Invitación
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Navegación entre Pasos (Inferior) */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '2rem',
                    paddingTop: '1.5rem',
                    borderTop: '1px solid hsl(var(--border))'
                }}>
                    {currentStep > 1 ? (
                        <button
                            type="button"
                            onClick={handlePrev}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                padding: '0.6rem 1rem',
                                background: 'none',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: 'var(--radius)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                color: 'inherit'
                            }}
                        >
                            <ArrowLeft size={16} /> Anterior
                        </button>
                    ) : <div />}

                    {currentStep < 5 && (
                        <button
                            type="button"
                            onClick={handleNext}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                padding: '0.6rem 1.2rem',
                                backgroundColor: 'hsl(var(--primary))',
                                color: 'hsl(var(--primary-foreground))',
                                border: 'none',
                                borderRadius: 'var(--radius)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600
                            }}
                        >
                            Siguiente <ArrowRight size={16} />
                        </button>
                    )}
                </div>

            </div>

            {/* Modal de previsualización segura de documentos */}
            {previewDoc && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1.5rem'
                }} onClick={() => {
                    if (previewDoc.url) URL.revokeObjectURL(previewDoc.url);
                    setPreviewDoc(null);
                }}>
                    <div style={{
                        backgroundColor: 'hsl(var(--card))',
                        borderRadius: 'var(--radius)',
                        maxWidth: '900px',
                        width: '100%',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
                    }} onClick={(e) => e.stopPropagation()}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '1rem 1.25rem',
                            borderBottom: '1px solid hsl(var(--border))'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={18} style={{ color: 'hsl(var(--primary))' }} />
                                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{previewDoc.name}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (previewDoc.url) URL.revokeObjectURL(previewDoc.url);
                                    setPreviewDoc(null);
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'hsl(var(--muted-foreground))'
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div style={{ padding: '1rem', flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
                            {previewDoc.isPdf ? (
                                <iframe
                                    src={previewDoc.url}
                                    title={previewDoc.name}
                                    style={{ width: '100%', height: '70vh', border: 'none', borderRadius: '4px' }}
                                />
                            ) : (
                                <img
                                    src={previewDoc.url}
                                    alt={previewDoc.name}
                                    style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
