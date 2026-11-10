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
    FileCheck
} from 'lucide-react';

const STORAGE_KEY = 'aciacam_new_socio_draft_v3';

export type SituacionReprocann = 'vigente' | 'vencido' | 'en_tramite' | 'no_posee';

interface FormData {
    // Paso 1: Identificación y Contacto
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

    // Paso 2: Situación REPROCANN (4 alternativas)
    situacionReprocann: SituacionReprocann;
    numeroTramite: string;
    fechaAlta: string;
    fechaVencimiento: string;
    tipoVinculacion: string;

    // Paso 4: Información Médica
    medicoNombre: string;
    medicoMatricula: string;
    diagnosticoPrincipal: string;
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
    enviosHabilitados: true, // Default true conforme a requerimiento
    idempotencyKey: '',

    situacionReprocann: 'vigente',
    numeroTramite: '',
    fechaAlta: '',
    fechaVencimiento: '',
    tipoVinculacion: 'ong',

    medicoNombre: '',
    medicoMatricula: '',
    diagnosticoPrincipal: ''
};

export default function NewSocioWizardPage() {
    const { user } = useAuth();
    const router = useRouter();

    const [currentStep, setCurrentStep] = useState<number>(1);
    const [formData, setFormData] = useState<FormData>(INITIAL_FORM);

    // Archivos adaptativos
    const [reprocannFile, setReprocannFile] = useState<File | null>(null);
    const [consentimientoMedicoFile, setConsentimientoMedicoFile] = useState<File | null>(null);
    const [constanciaTramiteFile, setConstanciaTramiteFile] = useState<File | null>(null);
    const [consentimientoAdhesionFile, setConsentimientoAdhesionFile] = useState<File | null>(null);

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
            // Guardar solo datos de formulario (sin archivos ni credenciales)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
        }, 600);
        return () => clearTimeout(timeout);
    }, [formData, isLoaded]);

    const handleChange = (field: keyof FormData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (validationError) setValidationError(null);
        if (bannerError) setBannerError(null);
    };

    const handleClearDraft = () => {
        if (window.confirm("¿Seguro que deseás descartar el borrador actual? Se restablecerán todos los campos.")) {
            localStorage.removeItem(STORAGE_KEY);
            const freshKey = `alta_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            setFormData({ ...INITIAL_FORM, idempotencyKey: freshKey });
            setReprocannFile(null);
            setConsentimientoMedicoFile(null);
            setConstanciaTramiteFile(null);
            setConsentimientoAdhesionFile(null);
            setCurrentStep(1);
            setValidationError(null);
            setBannerError(null);
        }
    };

    // Validación por paso
    const validateStep = (step: number): boolean => {
        setValidationError(null);
        setBannerError(null);

        const today = getSanLuisCivilToday();
        const todayStr = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;

        if (step === 1) {
            if (!formData.nombre.trim()) { setValidationError("El nombre es obligatorio"); return false; }
            if (!formData.apellido.trim()) { setValidationError("El apellido es obligatorio"); return false; }
            if (!formData.dni.trim()) { setValidationError("El DNI es obligatorio"); return false; }
            
            // Fecha de nacimiento obligatoria
            if (!formData.fechaNacimiento) {
                setValidationError("La fecha de nacimiento es obligatoria");
                return false;
            }
            if (!isValidCalendarDate(formData.fechaNacimiento)) {
                setValidationError("La fecha de nacimiento es inválida");
                return false;
            }
            if (formData.fechaNacimiento > todayStr) {
                setValidationError("La fecha de nacimiento no puede ser una fecha futura");
                return false;
            }
            const birthYear = parseInt(formData.fechaNacimiento.split('-')[0], 10);
            if (birthYear < today.year - 110) {
                setValidationError("La fecha de nacimiento ingresada no es válida");
                return false;
            }

            if (!formData.email.trim()) { setValidationError("El correo electrónico es obligatorio"); return false; }
            if (!formData.email.includes('@') || !formData.email.includes('.')) {
                setValidationError("El formato de correo electrónico no es válido");
                return false;
            }
            if (!formData.telefono.trim()) { setValidationError("El teléfono de contacto es obligatorio"); return false; }
        }

        if (step === 2) {
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
                    if (formData.fechaVencimiento > todayStr) {
                        setValidationError("Para un REPROCANN vencido, la fecha de vencimiento debe ser anterior o igual a la fecha de hoy");
                        return false;
                    }
                }
            } else if (sit === 'en_tramite') {
                if (!formData.numeroTramite.trim()) {
                    setValidationError("El número o código de trámite iniciado es obligatorio");
                    return false;
                }
            }
            // 'no_posee' no tiene campos obligatorios
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

    // Envío del formulario
    const handleSubmit = async (shouldInvite = false, asDraft = false) => {
        if (!validateStep(1) || !validateStep(2)) {
            return;
        }

        setLoading(true);
        setBannerError(null);
        setBannerSuccess(null);

        try {
            // Sanitización de fechas para PostgreSQL DATE
            const finalFechaAlta = (formData.situacionReprocann === 'vigente' || formData.situacionReprocann === 'vencido') && formData.fechaAlta
                ? formData.fechaAlta
                : undefined;
            const finalFechaVencimiento = (formData.situacionReprocann === 'vigente' || formData.situacionReprocann === 'vencido') && formData.fechaVencimiento
                ? formData.fechaVencimiento
                : undefined;
            const finalNumeroTramite = formData.situacionReprocann !== 'no_posee' && formData.numeroTramite.trim()
                ? formData.numeroTramite.trim()
                : undefined;

            // 1. Crear el socio en base de datos mediante el endpoint autenticado
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

            // 2. Subir archivos adjuntos adaptativos si fueron cargados
            if (reprocannFile) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: 'reprocann',
                        file: reprocannFile
                    });
                } catch (e: any) {
                    console.warn("No se pudo adjuntar el certificado REPROCANN:", e.message);
                }
            }

            if (consentimientoMedicoFile) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: 'consentimiento_medico',
                        file: consentimientoMedicoFile
                    });
                } catch (e: any) {
                    console.warn("No se pudo adjuntar el consentimiento médico:", e.message);
                }
            }

            if (constanciaTramiteFile) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: 'constancia_tramite',
                        file: constanciaTramiteFile
                    });
                } catch (e: any) {
                    console.warn("No se pudo adjuntar la constancia de trámite:", e.message);
                }
            }

            if (consentimientoAdhesionFile) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: 'consentimiento_adhesion',
                        file: consentimientoAdhesionFile
                    });
                } catch (e: any) {
                    console.warn("No se pudo adjuntar el consentimiento de adhesión ACIACAM:", e.message);
                }
            }

            // 3. Enviar invitación por email si fue solicitado
            let inviteWarning = '';
            if (shouldInvite) {
                try {
                    await StoreService.inviteSocio(newSocio.id);
                } catch (inviteErr: any) {
                    console.error("Fallo al enviar correo de invitación:", inviteErr);
                    inviteWarning = `Socio creado exitosamente, pero no se pudo enviar el correo: ${inviteErr.message}`;
                }
            }

            // 4. Limpiar borrador de localStorage ÚNICAMENTE tras confirmación exitosa
            localStorage.removeItem(STORAGE_KEY);

            const successMsg = inviteWarning || (shouldInvite 
                ? '¡Socio creado exitosamente y correo de invitación enviado!' 
                : 'Socio registrado correctamente.');
            setBannerSuccess(successMsg);

            // Redirección a la ficha tras breve pausa visual
            setTimeout(() => {
                router.push(`/admin/socios/${newSocio.id}`);
            }, 1000);

        } catch (err: any) {
            console.error("Error al registrar socio:", err);
            // El borrador se preserva intacto en localStorage
            setBannerError(err.message || 'Error desconocido al registrar el socio. El borrador fue conservado para que puedas reintentar.');
        } finally {
            setLoading(false);
        }
    };

    const steps = [
        { num: 1, title: 'Identificación', icon: User },
        { num: 2, title: 'REPROCANN', icon: ShieldCheck },
        { num: 3, title: 'Documentación', icon: Upload },
        { num: 4, title: 'Médico', icon: Stethoscope },
        { num: 5, title: 'Confirmación', icon: Check }
    ];

    return (
        <div style={{ maxWidth: '850px', margin: '0 auto', paddingBottom: '3rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
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
                Alta Progresiva de Socio
            </h1>
            <p style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '2rem', fontSize: '0.95rem' }}>
                Registrá nuevos socios o aspirantes contemplando todas las situaciones regulatorias. Los cambios se guardan automáticamente como borrador.
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

            {/* Banners de validación o error en pantalla (no intrusivos) */}
            {validationError && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius)',
                    backgroundColor: 'hsl(var(--destructive) / 0.1)',
                    color: 'hsl(var(--destructive))',
                    border: '1px solid hsl(var(--destructive) / 0.3)',
                    marginBottom: '1.5rem',
                    fontSize: '0.9rem'
                }}>
                    <AlertCircle size={18} />
                    <span>{validationError}</span>
                </div>
            )}

            {bannerError && (
                <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '1rem',
                    borderRadius: 'var(--radius)',
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    border: '1px solid #f87171',
                    marginBottom: '1.5rem',
                    fontSize: '0.92rem'
                }}>
                    <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                        <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>Error al registrar el socio</div>
                        <div>{bannerError}</div>
                    </div>
                </div>
            )}

            {bannerSuccess && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '1rem',
                    borderRadius: 'var(--radius)',
                    backgroundColor: '#dcfce7',
                    color: '#166534',
                    border: '1px solid #86efac',
                    marginBottom: '1.5rem',
                    fontSize: '0.92rem',
                    fontWeight: 600
                }}>
                    <CheckCircle size={20} />
                    <span>{bannerSuccess}</span>
                </div>
            )}

            {/* Contenido del Paso Actual */}
            <div style={{
                backgroundColor: 'hsl(var(--card))',
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--border))',
                padding: '2rem',
                boxShadow: 'var(--shadow-sm)'
            }}>

                {/* ============================================================== */}
                {/* PASO 1: Identificación y Contacto */}
                {/* ============================================================== */}
                {currentStep === 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div style={{ borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.75rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Identificación y Contacto</h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                                Datos personales del socio. Todos los campos marcados con * son obligatorios.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Nombre *
                                </label>
                                <input
                                    type="text"
                                    value={formData.nombre}
                                    onChange={(e) => handleChange('nombre', e.target.value)}
                                    placeholder="Ej: Juan"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Apellido *
                                </label>
                                <input
                                    type="text"
                                    value={formData.apellido}
                                    onChange={(e) => handleChange('apellido', e.target.value)}
                                    placeholder="Ej: Pérez"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    DNI / Pasaporte *
                                </label>
                                <input
                                    type="text"
                                    value={formData.dni}
                                    onChange={(e) => handleChange('dni', e.target.value)}
                                    placeholder="Ej: 32456789"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Fecha de Nacimiento * (Fecha Calendario)
                                </label>
                                <input
                                    type="date"
                                    value={formData.fechaNacimiento}
                                    onChange={(e) => handleChange('fechaNacimiento', e.target.value)}
                                    max={getSanLuisCivilToday().year + '-12-31'}
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                                {formData.fechaNacimiento && isValidCalendarDate(formData.fechaNacimiento) && (
                                    <span style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>
                                        Fecha civil registrada: {formatCalendarDate(formData.fechaNacimiento)}
                                    </span>
                                )}
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Correo Electrónico *
                                </label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => handleChange('email', e.target.value)}
                                    placeholder="juan.perez@ejemplo.com"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Teléfono / WhatsApp *
                                </label>
                                <input
                                    type="tel"
                                    value={formData.telefono}
                                    onChange={(e) => handleChange('telefono', e.target.value)}
                                    placeholder="+54 9 266 4000000"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Domicilio
                                </label>
                                <input
                                    type="text"
                                    value={formData.direccion}
                                    onChange={(e) => handleChange('direccion', e.target.value)}
                                    placeholder="Calle, número, piso, dpto"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Localidad / Ciudad
                                </label>
                                <input
                                    type="text"
                                    value={formData.localidad}
                                    onChange={(e) => handleChange('localidad', e.target.value)}
                                    placeholder="Ej: San Luis, Villa Mercedes"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>
                        </div>

                        {/* Control de Delivery Habilitado por Defecto */}
                        <div style={{
                            marginTop: '0.5rem',
                            padding: '1rem',
                            borderRadius: 'var(--radius)',
                            backgroundColor: 'hsl(var(--muted) / 0.4)',
                            border: '1px solid hsl(var(--border))',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.75rem'
                        }}>
                            <input
                                type="checkbox"
                                id="enviosHabilitados"
                                checked={formData.enviosHabilitados}
                                onChange={(e) => handleChange('enviosHabilitados', e.target.checked)}
                                style={{
                                    width: '18px',
                                    height: '18px',
                                    marginTop: '2px',
                                    cursor: 'pointer'
                                }}
                            />
                            <div style={{ flex: 1 }}>
                                <label htmlFor="enviosHabilitados" style={{ fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Truck size={16} /> Permitir delivery: Sí (habilitado por defecto)
                                </label>
                                <p style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', marginTop: '0.2rem' }}>
                                    Habilita la posibilidad de seleccionar entrega a domicilio en los pedidos del socio. Administración puede desactivarlo expresamente si no aplica.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ============================================================== */}
                {/* PASO 2: Situación REPROCANN (4 alternativas) */}
                {/* ============================================================== */}
                {currentStep === 2 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div style={{ borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.75rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Situación REPROCANN</h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                                Seleccioná la situación regulatoria oficial ante el Ministerio de Salud.
                            </p>
                        </div>

                        {/* 4 Opciones Visuales */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                            {[
                                { id: 'vigente', title: 'Vigente', desc: 'Con certificado oficial activo' },
                                { id: 'vencido', title: 'Vencido', desc: 'Vigencia expirada, a renovar' },
                                { id: 'en_tramite', title: 'En Trámite', desc: 'Gestión iniciada en Mi Argentina' },
                                { id: 'no_posee', title: 'No posee / A gestionar', desc: 'Aspirante sin trámite iniciado' }
                            ].map(opt => {
                                const isSelected = formData.situacionReprocann === opt.id;
                                return (
                                    <div
                                        key={opt.id}
                                        onClick={() => handleChange('situacionReprocann', opt.id)}
                                        style={{
                                            border: `2px solid ${isSelected ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                                            backgroundColor: isSelected ? 'hsl(var(--primary) / 0.05)' : 'hsl(var(--card))',
                                            borderRadius: 'var(--radius)',
                                            padding: '1rem',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: isSelected ? 'hsl(var(--primary))' : 'inherit' }}>
                                            {opt.title}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))', marginTop: '0.25rem' }}>
                                            {opt.desc}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Formulario según la situación elegida */}
                        {formData.situacionReprocann === 'vigente' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Número de Trámite REPROCANN *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.numeroTramite}
                                            onChange={(e) => handleChange('numeroTramite', e.target.value)}
                                            placeholder="Ej: 123456 o CÓDIGO-OFICIAL"
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Tipo de Vinculación
                                        </label>
                                        <select
                                            value={formData.tipoVinculacion}
                                            onChange={(e) => handleChange('tipoVinculacion', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        >
                                            <option value="ong">ONG / Cultivo Colectivo ACIACAM</option>
                                            <option value="autocultivo">Autocultivo Individual</option>
                                            <option value="familiar">Familiar / Tercero Cultivador</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Fecha de Emisión / Alta (Opcional)
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.fechaAlta}
                                            onChange={(e) => handleChange('fechaAlta', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Fecha de Vencimiento *
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.fechaVencimiento}
                                            onChange={(e) => handleChange('fechaVencimiento', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {formData.situacionReprocann === 'vencido' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                                <div style={{
                                    padding: '0.75rem 1rem',
                                    borderRadius: 'var(--radius)',
                                    backgroundColor: '#fffbeb',
                                    color: '#92400e',
                                    border: '1px solid #fcd34d',
                                    fontSize: '0.85rem'
                                }}>
                                    <Info size={16} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
                                    El socio se registrará con estado regulatorio <strong>Vencido</strong>. Las dispensas no estarán habilitadas hasta presentar una autorización renovada y vigente.
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Número de Trámite Anterior *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.numeroTramite}
                                            onChange={(e) => handleChange('numeroTramite', e.target.value)}
                                            placeholder="Número del certificado expirado"
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Fecha en que Venció (Vencimiento)
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.fechaVencimiento}
                                            onChange={(e) => handleChange('fechaVencimiento', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {formData.situacionReprocann === 'en_tramite' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                                <div style={{
                                    padding: '0.75rem 1rem',
                                    borderRadius: 'var(--radius)',
                                    backgroundColor: '#eff6ff',
                                    color: '#1e40af',
                                    border: '1px solid #bfdbfe',
                                    fontSize: '0.85rem'
                                }}>
                                    <Info size={16} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
                                    El trámite se encuentra iniciado en Mi Argentina. En el paso siguiente podrás adjuntar el consentimiento informado médico y/o la constancia de inicio. El estado regulatorio permanecerá como <strong>En Trámite</strong> sin habilitar dispensas.
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Número de Trámite Oficial * (Código Mi Argentina)
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.numeroTramite}
                                            onChange={(e) => handleChange('numeroTramite', e.target.value)}
                                            placeholder="Código de trámite iniciado"
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                            Tipo de Vinculación Solicitada
                                        </label>
                                        <select
                                            value={formData.tipoVinculacion}
                                            onChange={(e) => handleChange('tipoVinculacion', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid hsl(var(--input))',
                                                backgroundColor: 'hsl(var(--background))'
                                            }}
                                        >
                                            <option value="ong">ONG / Cultivo Colectivo ACIACAM</option>
                                            <option value="autocultivo">Autocultivo Individual</option>
                                            <option value="familiar">Familiar / Tercero</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {formData.situacionReprocann === 'no_posee' && (
                            <div style={{
                                padding: '1.25rem',
                                borderRadius: 'var(--radius)',
                                backgroundColor: 'hsl(var(--muted) / 0.4)',
                                border: '1px solid hsl(var(--border))',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.5rem'
                            }}>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Info size={18} color="hsl(var(--primary))" /> Aspirante sin REPROCANN
                                </div>
                                <p style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>
                                    No se exigirá número de trámite ni fechas en esta etapa. El socio quedará registrado como aspirante y el equipo de ACIACAM lo acompañará para iniciar la vinculación médica y oficial cuando lo requiera.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* ============================================================== */}
                {/* PASO 3: Carga de Documentación Adaptativa */}
                {/* ============================================================== */}
                {currentStep === 3 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div style={{ borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.75rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Carga de Documentación</h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                                Documentación adaptada a la situación: <strong>{formData.situacionReprocann.toUpperCase()}</strong>. Los archivos quedarán en revisión administrativa.
                            </p>
                        </div>

                        {/* Documentación para Vigente o Vencido */}
                        {(formData.situacionReprocann === 'vigente' || formData.situacionReprocann === 'vencido') && (
                            <div style={{
                                padding: '1.25rem',
                                borderRadius: 'var(--radius)',
                                border: '1px solid hsl(var(--border))',
                                backgroundColor: 'hsl(var(--background))'
                            }}>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <FileCheck size={18} color="hsl(var(--primary))" />
                                    {formData.situacionReprocann === 'vigente' ? 'Certificado REPROCANN (PDF o Imagen)' : 'Certificado REPROCANN Anterior (Opcional)'}
                                </div>
                                <p style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', marginBottom: '0.75rem' }}>
                                    Certificado emitido por el Ministerio de Salud de la Nación.
                                </p>
                                <input
                                    type="file"
                                    accept=".pdf,image/png,image/jpeg"
                                    onChange={(e) => setReprocannFile(e.target.files?.[0] || null)}
                                    style={{ fontSize: '0.85rem' }}
                                />
                                {reprocannFile && (
                                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'hsl(var(--primary))', fontWeight: 600 }}>
                                        ✓ Archivo seleccionado: {reprocannFile.name} ({(reprocannFile.size / 1024).toFixed(1)} KB)
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Documentación para En Trámite */}
                        {formData.situacionReprocann === 'en_tramite' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{
                                    padding: '1.25rem',
                                    borderRadius: 'var(--radius)',
                                    border: '1px solid hsl(var(--border))',
                                    backgroundColor: 'hsl(var(--background))'
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Stethoscope size={18} color="hsl(var(--primary))" /> Consentimiento Informado Médico (REPROCANN)
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', marginBottom: '0.75rem' }}>
                                        Consentimiento clínico firmado junto al médico tratante para el trámite oficial.
                                    </p>
                                    <input
                                        type="file"
                                        accept=".pdf,image/png,image/jpeg"
                                        onChange={(e) => setConsentimientoMedicoFile(e.target.files?.[0] || null)}
                                        style={{ fontSize: '0.85rem' }}
                                    />
                                    {consentimientoMedicoFile && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'hsl(var(--primary))', fontWeight: 600 }}>
                                            ✓ Archivo seleccionado: {consentimientoMedicoFile.name} ({(consentimientoMedicoFile.size / 1024).toFixed(1)} KB)
                                        </div>
                                    )}
                                </div>

                                <div style={{
                                    padding: '1.25rem',
                                    borderRadius: 'var(--radius)',
                                    border: '1px solid hsl(var(--border))',
                                    backgroundColor: 'hsl(var(--background))'
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Upload size={18} color="hsl(var(--primary))" /> Constancia de Trámite Iniciado (Opcional)
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', marginBottom: '0.75rem' }}>
                                        Captura de pantalla o comprobante de inicio emitido por Mi Argentina.
                                    </p>
                                    <input
                                        type="file"
                                        accept=".pdf,image/png,image/jpeg"
                                        onChange={(e) => setConstanciaTramiteFile(e.target.files?.[0] || null)}
                                        style={{ fontSize: '0.85rem' }}
                                    />
                                    {constanciaTramiteFile && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'hsl(var(--primary))', fontWeight: 600 }}>
                                            ✓ Archivo seleccionado: {constanciaTramiteFile.name} ({(constanciaTramiteFile.size / 1024).toFixed(1)} KB)
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Documentación para No Posee */}
                        {formData.situacionReprocann === 'no_posee' && (
                            <div style={{
                                padding: '1.25rem',
                                borderRadius: 'var(--radius)',
                                backgroundColor: 'hsl(var(--muted) / 0.3)',
                                border: '1px solid hsl(var(--border))',
                                fontSize: '0.85rem',
                                color: 'hsl(var(--muted-foreground))'
                            }}>
                                <Info size={16} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
                                No es obligatorio adjuntar documentación en esta instancia. Podés continuar al siguiente paso y completar los datos cuando el aspirante comience la gestión.
                            </div>
                        )}

                        {/* Convenio Institucional / Adhesión ACIACAM (común a todos los escenarios) */}
                        <div style={{
                            padding: '1.25rem',
                            borderRadius: 'var(--radius)',
                            border: '1px dashed hsl(var(--border))',
                            backgroundColor: 'hsl(var(--card))'
                        }}>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileCheck size={18} color="hsl(var(--muted-foreground))" /> Convenio Institucional de Adhesión ACIACAM (Opcional)
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', marginBottom: '0.75rem' }}>
                                Estatuto y términos asociativos firmados con la asociación (no confundir con el consentimiento médico).
                            </p>
                            <input
                                type="file"
                                accept=".pdf,image/png,image/jpeg"
                                onChange={(e) => setConsentimientoAdhesionFile(e.target.files?.[0] || null)}
                                style={{ fontSize: '0.85rem' }}
                            />
                            {consentimientoAdhesionFile && (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'hsl(var(--primary))', fontWeight: 600 }}>
                                    ✓ Archivo seleccionado: {consentimientoAdhesionFile.name} ({(consentimientoAdhesionFile.size / 1024).toFixed(1)} KB)
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ============================================================== */}
                {/* PASO 4: Información Médica */}
                {/* ============================================================== */}
                {currentStep === 4 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div style={{ borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.75rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Información Médica</h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                                Registro del profesional prescriptor y patología para seguimiento fitoterapéutico.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Médico Tratante
                                </label>
                                <input
                                    type="text"
                                    value={formData.medicoNombre}
                                    onChange={(e) => handleChange('medicoNombre', e.target.value)}
                                    placeholder="Dr./Dra. Nombre y Apellido"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Matrícula Profesional
                                </label>
                                <input
                                    type="text"
                                    value={formData.medicoMatricula}
                                    onChange={(e) => handleChange('medicoMatricula', e.target.value)}
                                    placeholder="MN / MP N°"
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                                    Diagnóstico Principal / Patología
                                </label>
                                <textarea
                                    value={formData.diagnosticoPrincipal}
                                    onChange={(e) => handleChange('diagnosticoPrincipal', e.target.value)}
                                    placeholder="Ej: Dolor crónico, insomnio, etc."
                                    rows={3}
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid hsl(var(--input))',
                                        backgroundColor: 'hsl(var(--background))',
                                        fontFamily: 'inherit',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ============================================================== */}
                {/* PASO 5: Revisión y Confirmación */}
                {/* ============================================================== */}
                {currentStep === 5 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div style={{ borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.75rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Revisión y Confirmación</h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                                Verificá la información antes de guardar el registro en el sistema.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Resumen Personal */}
                            <div style={{ padding: '1rem', backgroundColor: 'hsl(var(--muted) / 0.3)', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <User size={16} /> Identificación y Contacto
                                </div>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
                                    <div><strong>Nombre:</strong> {formData.nombre} {formData.apellido}</div>
                                    <div><strong>DNI:</strong> {formData.dni}</div>
                                    <div><strong>Nacimiento:</strong> {formatCalendarDate(formData.fechaNacimiento)}</div>
                                    <div><strong>Email:</strong> {formData.email}</div>
                                    <div><strong>Teléfono:</strong> {formData.telefono}</div>
                                    {formData.direccion && <div><strong>Domicilio:</strong> {formData.direccion} ({formData.localidad || 'S/D'})</div>}
                                    <div><strong>Delivery:</strong> {formData.enviosHabilitados ? '✓ Habilitado' : '✗ Deshabilitado'}</div>
                                </div>
                            </div>

                            {/* Resumen Regulatorio */}
                            <div style={{ padding: '1rem', backgroundColor: 'hsl(var(--muted) / 0.3)', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <ShieldCheck size={16} /> Situación REPROCANN
                                </div>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
                                    <div><strong>Situación:</strong> {formData.situacionReprocann.toUpperCase()}</div>
                                    {formData.numeroTramite && <div><strong>N° Trámite:</strong> {formData.numeroTramite}</div>}
                                    {formData.fechaAlta && <div><strong>Emisión:</strong> {formatCalendarDate(formData.fechaAlta)}</div>}
                                    {formData.fechaVencimiento && <div><strong>Vencimiento:</strong> {formatCalendarDate(formData.fechaVencimiento)}</div>}
                                    {formData.tipoVinculacion && <div><strong>Vinculación:</strong> {formData.tipoVinculacion}</div>}
                                </div>
                            </div>

                            {/* Resumen Documental */}
                            <div style={{ padding: '1rem', backgroundColor: 'hsl(var(--muted) / 0.3)', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Upload size={16} /> Documentos Adjuntos
                                </div>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
                                    <div><strong>Certificado REPROCANN:</strong> {reprocannFile ? reprocannFile.name : 'No adjuntado'}</div>
                                    <div><strong>Consentimiento Médico:</strong> {consentimientoMedicoFile ? consentimientoMedicoFile.name : 'No adjuntado'}</div>
                                    <div><strong>Constancia Trámite:</strong> {constanciaTramiteFile ? constanciaTramiteFile.name : 'No adjuntado'}</div>
                                    <div><strong>Adhesión ACIACAM:</strong> {consentimientoAdhesionFile ? consentimientoAdhesionFile.name : 'No adjuntado'}</div>
                                </div>
                            </div>

                            {/* Resumen Médico */}
                            <div style={{ padding: '1rem', backgroundColor: 'hsl(var(--muted) / 0.3)', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Stethoscope size={16} /> Información Médica
                                </div>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
                                    <div><strong>Médico:</strong> {formData.medicoNombre || 'No informado'}</div>
                                    <div><strong>Matrícula:</strong> {formData.medicoMatricula || 'No informada'}</div>
                                    <div><strong>Diagnóstico:</strong> {formData.diagnosticoPrincipal || 'No informado'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer Controls / Navigation */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '2rem',
                    paddingTop: '1.5rem',
                    borderTop: '1px solid hsl(var(--border))'
                }}>
                    {currentStep > 1 ? (
                        <button
                            type="button"
                            onClick={handlePrev}
                            disabled={loading}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                padding: '0.6rem 1.2rem',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: 'var(--radius)',
                                backgroundColor: 'transparent',
                                cursor: 'pointer',
                                fontSize: '0.9rem'
                            }}
                        >
                            <ArrowLeft size={16} /> Anterior
                        </button>
                    ) : (
                        <div />
                    )}

                    {currentStep < 5 ? (
                        <button
                            type="button"
                            onClick={handleNext}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                padding: '0.65rem 1.4rem',
                                backgroundColor: 'hsl(var(--primary))',
                                color: 'hsl(var(--primary-foreground))',
                                border: 'none',
                                borderRadius: 'var(--radius)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '0.9rem'
                            }}
                        >
                            Siguiente <ArrowRight size={16} />
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                onClick={() => handleSubmit(false, true)}
                                disabled={loading}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.75rem 1.25rem',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    backgroundColor: 'transparent',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    opacity: loading ? 0.6 : 1
                                }}
                            >
                                <Save size={16} /> Guardar como Borrador
                            </button>

                            <button
                                type="button"
                                onClick={() => handleSubmit(false, false)}
                                disabled={loading}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.75rem 1.5rem',
                                    backgroundColor: 'hsl(var(--secondary))',
                                    color: 'hsl(var(--secondary-foreground))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: 500,
                                    opacity: loading ? 0.6 : 1
                                }}
                            >
                                Guardar (Solo Crear)
                            </button>

                            <button
                                type="button"
                                onClick={() => handleSubmit(true, false)}
                                disabled={loading}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.75rem 1.75rem',
                                    backgroundColor: 'hsl(var(--primary))',
                                    color: 'hsl(var(--primary-foreground))',
                                    border: 'none',
                                    borderRadius: 'var(--radius)',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    fontWeight: 700,
                                    fontSize: '0.9rem',
                                    opacity: loading ? 0.6 : 1
                                }}
                            >
                                <Send size={16} /> {loading ? 'Registrando socio...' : 'Guardar y Enviar Invitación'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
