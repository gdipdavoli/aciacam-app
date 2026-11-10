"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { StorageService } from '@/services/storageService';
import { 
    ArrowLeft, 
    ArrowRight, 
    Check, 
    User, 
    FileText, 
    ShieldCheck, 
    Stethoscope, 
    Save, 
    Send, 
    Upload, 
    Trash2, 
    AlertCircle, 
    Clock 
} from 'lucide-react';

const STORAGE_KEY = 'aciacam_new_socio_draft_v2';

interface FormData {
    // Paso 1: Identificación y Contacto
    nombre: string;
    apellido: string;
    dni: string;
    email: string;
    telefono: string;
    direccion: string;
    localidad: string;

    // Paso 2: Situación REPROCANN
    tieneReprocann: 'si' | 'en_tramite' | 'no';
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
    email: '',
    telefono: '',
    direccion: '',
    localidad: '',

    tieneReprocann: 'si',
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
    const [reprocannFile, setReprocannFile] = useState<File | null>(null);
    const [consentimientoFile, setConsentimientoFile] = useState<File | null>(null);
    const [ddjjFile, setDdjjFile] = useState<File | null>(null);

    const [loading, setLoading] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    // 1. Cargar borrador de localStorage
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setFormData(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error("Error al cargar borrador de socio", e);
            }
        }
        setIsLoaded(true);
    }, []);

    // 2. Guardar borrador en localStorage automáticamente (debounced)
    useEffect(() => {
        if (!isLoaded) return;
        const timeout = setTimeout(() => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
        }, 600);
        return () => clearTimeout(timeout);
    }, [formData, isLoaded]);

    const handleChange = (field: keyof FormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setValidationError(null);
    };

    const handleClearDraft = () => {
        if (window.confirm("¿Seguro que deseás descartar el borrador y comenzar de nuevo?")) {
            localStorage.removeItem(STORAGE_KEY);
            setFormData(INITIAL_FORM);
            setReprocannFile(null);
            setConsentimientoFile(null);
            setDdjjFile(null);
            setCurrentStep(1);
        }
    };

    // Validaciones por paso
    const validateStep = (step: number): boolean => {
        setValidationError(null);
        if (step === 1) {
            if (!formData.nombre.trim()) { setValidationError("El nombre es obligatorio"); return false; }
            if (!formData.apellido.trim()) { setValidationError("El apellido es obligatorio"); return false; }
            if (!formData.dni.trim() || formData.dni.length < 6) { setValidationError("Ingresá un DNI válido"); return false; }
            if (!formData.email.trim() || !formData.email.includes('@')) { setValidationError("Ingresá un correo electrónico válido"); return false; }
            if (!formData.telefono.trim()) { setValidationError("El teléfono de contacto es obligatorio"); return false; }
        }
        if (step === 2 && formData.tieneReprocann === 'si') {
            if (formData.fechaAlta && formData.fechaVencimiento && formData.fechaVencimiento < formData.fechaAlta) {
                setValidationError("La fecha de vencimiento no puede ser anterior a la fecha de emisión");
                return false;
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
        setCurrentStep(prev => Math.max(prev - 1, 1));
    };

    // Envío del formulario
    const handleSubmit = async (shouldInvite = false, asDraft = false) => {
        if (!validateStep(1)) {
            setCurrentStep(1);
            return;
        }

        setLoading(true);
        try {
            // 1. Crear el socio en base de datos con todos los campos capturados
            const newSocio = await StoreService.createSocio({
                nombre: formData.nombre.trim(),
                apellido: formData.apellido.trim(),
                dni: formData.dni.trim(),
                email: formData.email.trim().toLowerCase(),
                telefono: formData.telefono.trim(),
                direccion: formData.direccion.trim() || undefined,
                localidad: formData.localidad.trim() || undefined,
                rol: 'socio',
                status: asDraft ? 'draft' : 'active',
                reprocann: {
                    numeroTramite: formData.numeroTramite.trim() || undefined,
                    fechaAlta: formData.fechaAlta || undefined,
                    fechaVencimiento: formData.fechaVencimiento || undefined,
                    tipo: formData.tipoVinculacion || undefined,
                    estado: formData.tieneReprocann === 'si' ? 'pendiente' : 'pendiente'
                } as any,
                medicoNombre: formData.medicoNombre.trim() || undefined,
                medicoMatricula: formData.medicoMatricula.trim() || undefined,
                diagnosticoPrincipal: formData.diagnosticoPrincipal.trim() || undefined,
            });

            if (!newSocio?.id) {
                throw new Error("No se pudo obtener el identificador del nuevo socio");
            }

            // 2. Subir archivos adjuntos si fueron cargados
            if (reprocannFile) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: 'reprocann',
                        file: reprocannFile
                    });
                } catch (e: any) {
                    console.warn("No se pudo adjuntar el archivo REPROCANN en el alta:", e.message);
                }
            }
            if (consentimientoFile) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: 'consentimiento',
                        file: consentimientoFile
                    });
                } catch (e: any) {
                    console.warn("No se pudo adjuntar el consentimiento:", e.message);
                }
            }
            if (ddjjFile) {
                try {
                    await StorageService.uploadSocioDocument({
                        socioId: newSocio.id,
                        docType: 'declaracion_jurada',
                        file: ddjjFile
                    });
                } catch (e: any) {
                    console.warn("No se pudo adjuntar la DDJJ:", e.message);
                }
            }

            // 3. Enviar invitación por email si fue solicitado
            if (shouldInvite) {
                try {
                    await StoreService.inviteSocio(newSocio.id);
                } catch (inviteErr: any) {
                    console.error("Fallo al enviar correo de invitación:", inviteErr);
                    alert(`Socio guardado exitosamente, pero falló el envío de la invitación: ${inviteErr.message}`);
                }
            }

            localStorage.removeItem(STORAGE_KEY);
            alert(shouldInvite 
                ? '¡Socio creado exitosamente y correo de invitación enviado!' 
                : 'Socio registrado correctamente.');
            router.push(`/admin/socios/${newSocio.id}`);

        } catch (err: any) {
            console.error("Error al registrar socio:", err);
            alert(`Error al registrar el socio: ${err.message || 'Error desconocido'}`);
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
                Completá los datos del nuevo socio de forma ordenada. Los cambios se guardan automáticamente como borrador.
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

            {/* Error Banner */}
            {validationError && (
                <div style={{
                    padding: '0.75rem 1rem',
                    marginBottom: '1.5rem',
                    backgroundColor: 'hsl(var(--destructive) / 0.1)',
                    border: '1px solid hsl(var(--destructive))',
                    borderRadius: 'var(--radius)',
                    color: 'hsl(var(--destructive))',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.9rem'
                }}>
                    <AlertCircle size={18} />
                    <span>{validationError}</span>
                </div>
            )}

            {/* Form Content */}
            <div style={{
                backgroundColor: 'hsl(var(--card))',
                padding: '2rem',
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--border))',
                marginBottom: '1.5rem'
            }}>
                {/* PASO 1: Identificación y Contacto */}
                {currentStep === 1 && (
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.25rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                            Paso 1: Identificación y Contacto
                        </h2>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Nombre *</label>
                                <input
                                    type="text"
                                    value={formData.nombre}
                                    onChange={e => handleChange('nombre', e.target.value)}
                                    placeholder="Ej: Juan"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Apellido *</label>
                                <input
                                    type="text"
                                    value={formData.apellido}
                                    onChange={e => handleChange('apellido', e.target.value)}
                                    placeholder="Ej: Pérez"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>DNI *</label>
                                <input
                                    type="text"
                                    value={formData.dni}
                                    onChange={e => handleChange('dni', e.target.value)}
                                    placeholder="Número de DNI sin puntos"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Teléfono *</label>
                                <input
                                    type="tel"
                                    value={formData.telefono}
                                    onChange={e => handleChange('telefono', e.target.value)}
                                    placeholder="Ej: +54 9 266 4123456"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div style={{ gridColumn: 'span 2' }}>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Email *</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => handleChange('email', e.target.value)}
                                    placeholder="socio@ejemplo.com"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Domicilio (Calle y número)</label>
                                <input
                                    type="text"
                                    value={formData.direccion}
                                    onChange={e => handleChange('direccion', e.target.value)}
                                    placeholder="Ej: Av. Illia 450"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Localidad</label>
                                <input
                                    type="text"
                                    value={formData.localidad}
                                    onChange={e => handleChange('localidad', e.target.value)}
                                    placeholder="Ej: San Luis Capital"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* PASO 2: Situación REPROCANN */}
                {currentStep === 2 && (
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.25rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                            Paso 2: Situación REPROCANN
                        </h2>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>¿Tiene autorización REPROCANN?</label>
                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                {[
                                    { val: 'si', label: 'Sí, posee certificado vigente' },
                                    { val: 'en_tramite', label: 'En trámite oficial' },
                                    { val: 'no', label: 'No posee / A gestionar' }
                                ].map(opt => (
                                    <label
                                        key={opt.val}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            padding: '0.75rem 1rem',
                                            border: formData.tieneReprocann === opt.val ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                                            borderRadius: 'var(--radius)',
                                            backgroundColor: formData.tieneReprocann === opt.val ? 'hsl(var(--primary) / 0.05)' : 'transparent',
                                            cursor: 'pointer',
                                            fontSize: '0.9rem'
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="tieneReprocann"
                                            checked={formData.tieneReprocann === opt.val}
                                            onChange={() => handleChange('tieneReprocann', opt.val as any)}
                                        />
                                        {opt.label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {formData.tieneReprocann !== 'no' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1.25rem', backgroundColor: 'hsl(var(--muted) / 0.3)', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Número de Trámite REPROCANN</label>
                                    <input
                                        type="text"
                                        value={formData.numeroTramite}
                                        onChange={e => handleChange('numeroTramite', e.target.value)}
                                        placeholder="Ej: 123456"
                                        style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Fecha de Emisión / Alta</label>
                                    <input
                                        type="date"
                                        value={formData.fechaAlta}
                                        onChange={e => handleChange('fechaAlta', e.target.value)}
                                        style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Fecha de Vencimiento</label>
                                    <input
                                        type="date"
                                        value={formData.fechaVencimiento}
                                        onChange={e => handleChange('fechaVencimiento', e.target.value)}
                                        style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }}
                                    />
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Tipo de Vinculación</label>
                                    <select
                                        value={formData.tipoVinculacion}
                                        onChange={e => handleChange('tipoVinculacion', e.target.value)}
                                        style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }}
                                    >
                                        <option value="ong">ONG / ACIACAM</option>
                                        <option value="autocultivo">Autocultivo</option>
                                        <option value="solidario">Cultivador Solidario</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* PASO 3: Documentación Inicial */}
                {currentStep === 3 && (
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                            Paso 3: Carga de Documentación
                        </h2>
                        <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                            Podés adjuntar los documentos ahora o continuar y solicitarlos al socio tras su registro.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {/* REPROCANN File */}
                            <div style={{ border: '1px dashed hsl(var(--border))', padding: '1.25rem', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.1)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Certificado REPROCANN (PDF o imagen)</span>
                                    {reprocannFile && (
                                        <button onClick={() => setReprocannFile(null)} style={{ background: 'none', border: 'none', color: 'hsl(var(--destructive))', cursor: 'pointer', fontSize: '0.8rem' }}>
                                            Quitar
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="application/pdf,image/*"
                                    onChange={e => setReprocannFile(e.target.files?.[0] || null)}
                                    style={{ fontSize: '0.85rem' }}
                                />
                                {reprocannFile && (
                                    <div style={{ fontSize: '0.8rem', color: 'hsl(var(--primary))', marginTop: '0.4rem' }}>
                                        Archivo seleccionado: <strong>{reprocannFile.name}</strong>
                                    </div>
                                )}
                            </div>

                            {/* Consentimiento Informado File */}
                            <div style={{ border: '1px dashed hsl(var(--border))', padding: '1.25rem', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.1)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Consentimiento Informado (Opcional)</span>
                                    {consentimientoFile && (
                                        <button onClick={() => setConsentimientoFile(null)} style={{ background: 'none', border: 'none', color: 'hsl(var(--destructive))', cursor: 'pointer', fontSize: '0.8rem' }}>
                                            Quitar
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="application/pdf,image/*"
                                    onChange={e => setConsentimientoFile(e.target.files?.[0] || null)}
                                    style={{ fontSize: '0.85rem' }}
                                />
                                {consentimientoFile && (
                                    <div style={{ fontSize: '0.8rem', color: 'hsl(var(--primary))', marginTop: '0.4rem' }}>
                                        Archivo seleccionado: <strong>{consentimientoFile.name}</strong>
                                    </div>
                                )}
                            </div>

                            {/* Declaración Jurada File */}
                            <div style={{ border: '1px dashed hsl(var(--border))', padding: '1.25rem', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.1)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Declaración Jurada (Opcional)</span>
                                    {ddjjFile && (
                                        <button onClick={() => setDdjjFile(null)} style={{ background: 'none', border: 'none', color: 'hsl(var(--destructive))', cursor: 'pointer', fontSize: '0.8rem' }}>
                                            Quitar
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept="application/pdf,image/*"
                                    onChange={e => setDdjjFile(e.target.files?.[0] || null)}
                                    style={{ fontSize: '0.85rem' }}
                                />
                                {ddjjFile && (
                                    <div style={{ fontSize: '0.8rem', color: 'hsl(var(--primary))', marginTop: '0.4rem' }}>
                                        Archivo seleccionado: <strong>{ddjjFile.name}</strong>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* PASO 4: Información Médica */}
                {currentStep === 4 && (
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.25rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                            Paso 4: Información Médica y Diagnóstico
                        </h2>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Médico Prescriptor</label>
                                <input
                                    type="text"
                                    value={formData.medicoNombre}
                                    onChange={e => handleChange('medicoNombre', e.target.value)}
                                    placeholder="Nombre y apellido del profesional"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Matrícula Profesional</label>
                                <input
                                    type="text"
                                    value={formData.medicoMatricula}
                                    onChange={e => handleChange('medicoMatricula', e.target.value)}
                                    placeholder="Ej: MP 1234 / MN 5678"
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div style={{ gridColumn: 'span 2' }}>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>Diagnóstico Principal / Patología</label>
                                <textarea
                                    value={formData.diagnosticoPrincipal}
                                    onChange={e => handleChange('diagnosticoPrincipal', e.target.value)}
                                    placeholder="Patología indicada en el REPROCANN o tratamiento"
                                    style={{ width: '100%', minHeight: '80px', padding: '0.6rem', borderRadius: '4px', border: '1px solid hsl(var(--border))', backgroundColor: 'transparent', fontFamily: 'inherit' }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* PASO 5: Revisión y Confirmación */}
                {currentStep === 5 && (
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.25rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
                            Paso 5: Revisión y Registro
                        </h2>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
                            {/* Card 1: Datos Personales */}
                            <div style={{ padding: '1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.15)' }}>
                                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <User size={16} /> Identificación
                                </h3>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.6' }}>
                                    <div><strong>Nombre:</strong> {formData.nombre} {formData.apellido}</div>
                                    <div><strong>DNI:</strong> {formData.dni}</div>
                                    <div><strong>Email:</strong> {formData.email}</div>
                                    <div><strong>Teléfono:</strong> {formData.telefono}</div>
                                    <div><strong>Domicilio:</strong> {formData.direccion || '-'} ({formData.localidad || '-'})</div>
                                </div>
                            </div>

                            {/* Card 2: Situación REPROCANN */}
                            <div style={{ padding: '1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.15)' }}>
                                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <ShieldCheck size={16} /> REPROCANN
                                </h3>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.6' }}>
                                    <div><strong>Estado:</strong> {formData.tieneReprocann === 'si' ? 'Certificado Vigente' : (formData.tieneReprocann === 'en_tramite' ? 'En trámite' : 'No posee')}</div>
                                    {formData.tieneReprocann !== 'no' && (
                                        <>
                                            <div><strong>Trámite:</strong> {formData.numeroTramite || 'No informado'}</div>
                                            <div><strong>Alta:</strong> {formData.fechaAlta || '-'}</div>
                                            <div><strong>Vencimiento:</strong> {formData.fechaVencimiento || '-'}</div>
                                            <div><strong>Vinculación:</strong> {formData.tipoVinculacion.toUpperCase()}</div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Card 3: Documentación Adjunta */}
                            <div style={{ padding: '1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.15)' }}>
                                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <FileText size={16} /> Documentos Adjuntos
                                </h3>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.6' }}>
                                    <div>REPROCANN: {reprocannFile ? <span style={{ color: 'hsl(var(--primary))' }}>{reprocannFile.name}</span> : 'No adjuntado'}</div>
                                    <div>Consentimiento: {consentimientoFile ? <span style={{ color: 'hsl(var(--primary))' }}>{consentimientoFile.name}</span> : 'No adjuntado'}</div>
                                    <div>DDJJ: {ddjjFile ? <span style={{ color: 'hsl(var(--primary))' }}>{ddjjFile.name}</span> : 'No adjuntado'}</div>
                                </div>
                            </div>

                            {/* Card 4: Médico */}
                            <div style={{ padding: '1rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.15)' }}>
                                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Stethoscope size={16} /> Información Médica
                                </h3>
                                <div style={{ fontSize: '0.85rem', lineHeight: '1.6' }}>
                                    <div><strong>Profesional:</strong> {formData.medicoNombre || 'No informado'}</div>
                                    <div><strong>Matrícula:</strong> {formData.medicoMatricula || 'No informada'}</div>
                                    <div><strong>Diagnóstico:</strong> {formData.diagnosticoPrincipal || 'No informado'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Wizard Navigation Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    {currentStep > 1 && (
                        <button
                            type="button"
                            onClick={handlePrev}
                            disabled={loading}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem 1.25rem',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: 'var(--radius)',
                                backgroundColor: 'transparent',
                                cursor: 'pointer',
                                fontSize: '0.9rem'
                            }}
                        >
                            <ArrowLeft size={16} /> Anterior
                        </button>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {currentStep < 5 ? (
                        <button
                            type="button"
                            onClick={handleNext}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem 1.75rem',
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
                        <>
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
                                    cursor: 'pointer',
                                    fontSize: '0.9rem'
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
                                    cursor: 'pointer',
                                    fontSize: '0.9rem'
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
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    fontSize: '0.9rem'
                                }}
                            >
                                <Send size={16} /> {loading ? 'Registrando...' : 'Guardar y Enviar Invitación'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
