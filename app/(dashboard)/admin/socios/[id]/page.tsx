"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { StorageService } from '@/services/storageService';
import { Socio, Pedido, DocumentoSocio, DocumentacionSocio, EstadoDocumento } from '@/types';
import { ArrowLeft, Save, FileText, Activity, AlertTriangle, CheckCircle, Edit, ExternalLink, X, Upload } from 'lucide-react';

const DOC_CONFIG: Record<string, { needsFecha: boolean; needsMonto: boolean; hasExpiration: boolean }> = {
    consentimiento: { needsFecha: false, needsMonto: false, hasExpiration: false },
    declaracionJurada: { needsFecha: true, needsMonto: false, hasExpiration: false },
    contratoCultivo: { needsFecha: true, needsMonto: true, hasExpiration: true },
    recetaMedica: { needsFecha: true, needsMonto: false, hasExpiration: true },
    contrato: { needsFecha: true, needsMonto: false, hasExpiration: true }
};

export default function SocioDetailsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [socio, setSocio] = useState<Socio | null>(null);
    const [orders, setOrders] = useState<Pedido[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Document Editing State
    const [editingDocKey, setEditingDocKey] = useState<keyof DocumentacionSocio | null>(null);
    const [docForm, setDocForm] = useState<DocumentoSocio>({ estado: 'pendiente' });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (!authLoading) {
            if (!user || user.rol !== 'admin') {
                router.push('/');
                return;
            }

            Promise.all([
                StoreService.getSocioById(id),
                StoreService.getPedidosBySocio(id)
            ]).then(([socioData, ordersData]) => {
                if (socioData) {
                    // Initialize nested objects
                    const initializedSocio = {
                        ...socioData,
                        reprocann: socioData.reprocann || { estado: 'pendiente' },
                        documentacion: {
                            consentimiento: socioData.documentacion?.consentimiento || { estado: 'pendiente' },
                            declaracionJurada: socioData.documentacion?.declaracionJurada || { estado: 'pendiente' },
                            contratoCultivo: socioData.documentacion?.contratoCultivo || { estado: 'pendiente' },
                            recetaMedica: socioData.documentacion?.recetaMedica || { estado: 'pendiente' },
                            contrato: socioData.documentacion?.contrato || { estado: 'pendiente' }
                        }
                    };
                    setSocio(initializedSocio);
                    setOrders(ordersData.sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()));
                }
                setLoading(false);
            });
        }
    }, [user, authLoading, router, id]);

    const handleUpdateSocio = async () => {
        if (!socio) return;
        setSaving(true);
        try {
            await StoreService.updateSocio(socio.id, socio);
            alert('Cambios guardados correctamente');
        } catch (error) {
            console.error(error);
            alert('Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    const handleEditDoc = (key: keyof DocumentacionSocio, doc: DocumentoSocio | undefined) => {
        setEditingDocKey(key);
        setDocForm(doc || { estado: 'pendiente' });
        setSelectedFile(null);
    };

    const handleSaveDoc = async () => {
        if (!socio || !editingDocKey) return;

        setUploading(true);
        try {
            let newPath = docForm.archivoPath;

            if (selectedFile) {
                const uploadResult = await StorageService.uploadSocioDocument({
                    socioId: socio.id,
                    file: selectedFile,
                    docType: editingDocKey as string
                });
                newPath = uploadResult.path;
            }

            const newDocData: DocumentoSocio = {
                ...docForm,
                archivoPath: newPath
            };

            // Update local state
            const updatedSocio = {
                ...socio,
                documentacion: {
                    ...socio.documentacion,
                    [editingDocKey]: newDocData
                }
            };
            setSocio(updatedSocio);

            // Save to store
            await StoreService.updateSocioDocumentacion(socio.id, editingDocKey as string, newDocData);

            setEditingDocKey(null);
        } catch (e: any) {
            console.error(e);
            alert("Error al guardar documento: " + (e.message || e));
        } finally {
            setUploading(false);
        }
    };

    const handleViewPdf = async (path: string) => {
        if (!path) return;
        const url = await StorageService.createSignedUrl(path);
        if (url) {
            window.open(url, '_blank');
        } else {
            alert('No se pudo generar el enlace seguro.');
        }
    };

    if (loading || authLoading) return <div style={{ padding: '2rem' }}>Cargando ficha...</div>;
    if (!socio) return <div style={{ padding: '2rem' }}>Socio no encontrado.</div>;

    // Helper UI Components
    const Section = ({ title, children, icon: Icon }: any) => (
        <section style={{
            backgroundColor: 'hsl(var(--card))',
            borderRadius: 'var(--radius)',
            border: '1px solid hsl(var(--border))',
            marginBottom: '1.5rem',
            overflow: 'hidden'
        }}>
            <div style={{
                padding: '1rem 1.5rem',
                borderBottom: '1px solid hsl(var(--border))',
                backgroundColor: 'hsl(var(--muted))',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
            }}>
                {Icon && <Icon size={18} />}
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{title}</h3>
            </div>
            <div style={{ padding: '1.5rem' }}>
                {children}
            </div>
        </section>
    );

    const InputGroup = ({ label, value, onChange, type = 'text', width = '100%', multiline = false, placeholder }: any) => (
        <div style={{ marginBottom: '1rem', width }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>{label}</label>
            {multiline ? (
                <textarea
                    value={value || ''}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid hsl(var(--border))', borderRadius: '4px', fontSize: '0.95rem', minHeight: '80px', fontFamily: 'inherit' }}
                />
            ) : (
                <input
                    type={type}
                    value={value || ''}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid hsl(var(--border))', borderRadius: '4px', fontSize: '0.95rem' }}
                />
            )}
        </div>
    );

    const SelectGroup = ({ label, value, onChange, options, width = '100%' }: any) => (
        <div style={{ marginBottom: '1rem', width }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>{label}</label>
            <select
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid hsl(var(--border))', borderRadius: '4px', fontSize: '0.95rem', backgroundColor: 'transparent' }}
            >
                {options.map((opt: any) => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
            </select>
        </div>
    );

    const Pill = ({ status }: { status: string }) => {
        let color = '#374151';
        let bg = '#f3f4f6';

        const good = ['vigente', 'activo', 'completo'];
        const bad = ['vencido', 'rescindido', 'rechazado'];
        const warn = ['pendiente', 'sin_contrato'];

        if (good.includes(status)) { color = '#166534'; bg = '#dcfce7'; }
        else if (bad.includes(status)) { color = '#991b1b'; bg = '#fee2e2'; }
        else if (warn.includes(status)) { color = '#b45309'; bg = '#ffedd5'; }

        return (
            <span style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '999px',
                backgroundColor: bg,
                color: color,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                fontWeight: 700,
                letterSpacing: '0.05em'
            }}>
                {status?.replace('_', ' ') || 'SIN DATOS'}
            </span>
        );
    };

    const docDefinitions: { key: keyof DocumentacionSocio, label: string }[] = [
        { key: 'declaracionJurada', label: 'Declaración Jurada' },
        { key: 'consentimiento', label: 'Consentimiento Informado' },
        { key: 'contratoCultivo', label: 'Contrato de Cultivo' },
        { key: 'recetaMedica', label: 'Receta Médica' },
        { key: 'contrato', label: 'Contrato General' },
    ];

    const currentDocConfig = editingDocKey ? DOC_CONFIG[editingDocKey] : null;

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '4rem' }}>

            {/* Header Sticky Bar */}
            <div style={{
                position: 'sticky',
                top: 0,
                zIndex: 10,
                backgroundColor: 'hsl(var(--background))',
                padding: '1rem 0',
                borderBottom: '1px solid hsl(var(--border))',
                marginBottom: '2rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', borderRadius: '50%', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', cursor: 'pointer' }}>
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{socio.apellido}, {socio.nombre}</h1>
                        <span style={{ fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))' }}>DNI {socio.dni}</span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                        onClick={handleUpdateSocio}
                        disabled={saving}
                        style={{
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'hsl(var(--primary-foreground))',
                            border: 'none',
                            padding: '0.75rem 1.5rem',
                            borderRadius: 'var(--radius)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            cursor: 'pointer',
                            fontWeight: 600,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            opacity: saving ? 0.8 : 1
                        }}
                    >
                        <Save size={18} />
                        {saving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem' }}>

                {/* Left Column (Main Info) */}
                <div style={{ gridColumn: 'span 8' }}>

                    {/* SECCION B: Datos Personales */}
                    <Section title="Datos Personales">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Nombre" value={socio.nombre} onChange={(v: string) => setSocio({ ...socio, nombre: v })} />
                            <InputGroup label="Apellido" value={socio.apellido} onChange={(v: string) => setSocio({ ...socio, apellido: v })} />
                            <InputGroup label="DNI" value={socio.dni} onChange={(v: string) => setSocio({ ...socio, dni: v })} />
                            <InputGroup label="Fecha Nacimiento" type="date" value={socio.fechaNacimiento} onChange={(v: string) => setSocio({ ...socio, fechaNacimiento: v })} />
                            <InputGroup label="Teléfono" value={socio.telefono} onChange={(v: string) => setSocio({ ...socio, telefono: v })} />
                            <InputGroup label="Email" value={socio.email} onChange={(v: string) => setSocio({ ...socio, email: v })} />
                        </div>
                    </Section>

                    {/* SECCION Docs: Documentación */}
                    <Section title="Documentación Presentada" icon={FileText}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid hsl(var(--border))', textAlign: 'left', color: 'hsl(var(--muted-foreground))' }}>
                                    <th style={{ padding: '0.75rem' }}>Documento</th>
                                    <th style={{ padding: '0.75rem' }}>Estado</th>
                                    <th style={{ padding: '0.75rem' }}>Vencimiento</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'right' }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {docDefinitions.map(def => {
                                    const doc = socio.documentacion?.[def.key];
                                    return (
                                        <tr key={def.key} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: 500 }}>{def.label}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <Pill status={doc?.estado || 'pendiente'} />
                                            </td>
                                            <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                                                {doc?.fechaVencimiento ? new Date(doc.fechaVencimiento).toLocaleDateString() : '-'}
                                                {doc?.fechaVencimiento && new Date(doc.fechaVencimiento) < new Date() && (
                                                    <span style={{ color: '#ef4444', marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 600 }}>(Vencido)</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.75rem', textAlign: 'right', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                {doc?.archivoPath && (
                                                    <button
                                                        onClick={() => handleViewPdf(doc.archivoPath!)}
                                                        style={{
                                                            padding: '0.4rem',
                                                            borderRadius: '4px',
                                                            backgroundColor: 'hsl(var(--muted))',
                                                            color: 'hsl(var(--foreground))',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            border: 'none',
                                                            cursor: 'pointer'
                                                        }}
                                                        title="Ver PDF"
                                                    >
                                                        <ExternalLink size={16} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleEditDoc(def.key, doc)}
                                                    style={{
                                                        padding: '0.4rem',
                                                        borderRadius: '4px',
                                                        backgroundColor: 'hsl(var(--primary))',
                                                        color: 'hsl(var(--primary-foreground))',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center'
                                                    }}
                                                    title="Editar"
                                                >
                                                    <Edit size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </Section>

                    {/* SECCION G: Médico y Diagnóstico */}
                    <Section title="Médico Tratante y Diagnóstico" icon={Activity}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Nombre del Médico" value={socio.medicoNombre} onChange={(v: string) => setSocio({ ...socio, medicoNombre: v })} />
                            <InputGroup label="Matrícula" value={socio.medicoMatricula} onChange={(v: string) => setSocio({ ...socio, medicoMatricula: v })} />
                        </div>
                        <InputGroup label="Diagnóstico Principal" value={socio.diagnosticoPrincipal} onChange={(v: string) => setSocio({ ...socio, diagnosticoPrincipal: v })} multiline />
                    </Section>

                    {/* SECCION D: Domicilio */}
                    <Section title="Domicilio">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Calle y Número" value={socio.direccion} onChange={(v: string) => setSocio({ ...socio, direccion: v })} />
                            <InputGroup label="Localidad" value={socio.localidad} onChange={(v: string) => setSocio({ ...socio, localidad: v })} />
                            <InputGroup label="Provincia" value={socio.provincia} onChange={(v: string) => setSocio({ ...socio, provincia: v })} />
                        </div>
                    </Section>

                    {/* SECCION I: Pedidos */}
                    <Section title={`Pedidos Asociados (${orders.length})`}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            {/* ... existing orders table content or simple placeholder as it was ... */}
                            <tbody>
                                {orders.length === 0 ? (
                                    <tr><td style={{ padding: '1rem', color: 'hsl(var(--muted-foreground))' }}>Sin pedidos recientes</td></tr>
                                ) : (
                                    orders.map(order => (
                                        <tr key={order.id} style={{ borderBottom: '1px dashed hsl(var(--border))' }}>
                                            <td style={{ padding: '0.75rem 0' }}>#{order.id.slice(-6)}</td>
                                            <td style={{ padding: '0.75rem 0' }}>{new Date(order.fechaCreacion).toLocaleDateString()}</td>
                                            <td style={{ padding: '0.75rem 0' }}>{order.tipoPedido}</td>
                                            <td style={{ padding: '0.75rem 0', fontWeight: 600 }}>{order.estado}</td>
                                            <td style={{ padding: '0.75rem 0', textAlign: 'right' }}><a href="#" style={{ color: 'hsl(var(--primary))' }}>Ver</a></td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </Section>
                </div>

                {/* Right Column (Admin & Status) */}
                <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {/* SECCION C: Datos Administrativos */}
                    <Section title="Administrativo" icon={FileText}>
                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <InputGroup label="Orden Libro" value={socio.ordenLibro as any} onChange={(v: string) => setSocio({ ...socio, ordenLibro: v as any })} type="number" />
                                <InputGroup label="Acta Nº" value={socio.actaNumero as any} onChange={(v: string) => setSocio({ ...socio, actaNumero: v as any })} type="number" />
                            </div>
                            <InputGroup label="Debe" value={socio.debe} onChange={(v: string) => setSocio({ ...socio, debe: v })} />
                            <InputGroup label="Fecha Ingreso ONG" type="date" value={socio.fechaIngresoOng} onChange={(v: string) => setSocio({ ...socio, fechaIngresoOng: v })} />
                            <SelectGroup
                                label="Vinculación"
                                value={socio.vinculacion}
                                onChange={(v: any) => setSocio({ ...socio, vinculacion: v })}
                                options={[
                                    { val: 'Solidario', label: 'Solidario' },
                                    { val: 'Particular', label: 'Particular' },
                                    { val: 'Terapéutico', label: 'Terapéutico' },
                                    { val: 'Investigación', label: 'Investigación' },
                                    { val: 'Otro', label: 'Otro' },
                                ]}
                            />
                            <SelectGroup label="Activo" value={socio.activo ? 'si' : 'no'} onChange={(v: string) => setSocio({ ...socio, activo: v === 'si' })} options={[{ val: 'si', label: 'Si' }, { val: 'no', label: 'No' }]} />
                        </div>
                    </Section>

                    {/* SECCION E: REPROCANN */}
                    <div style={{
                        backgroundColor: '#fff',
                        border: '1px solid #22c55e',
                        borderRadius: 'var(--radius)',
                        padding: '1.5rem',
                        boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.1)'
                    }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#15803d', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <CheckCircle size={18} /> REPROCANN
                        </h3>
                        <InputGroup label="Nº Trámite" value={socio.reprocann?.numeroTramite} onChange={(v: string) => setSocio({ ...socio, reprocann: { ...socio.reprocann, numeroTramite: v } })} />
                        <InputGroup label="Fecha Alta" type="date" value={socio.reprocann?.fechaAlta} onChange={(v: string) => setSocio({ ...socio, reprocann: { ...socio.reprocann, fechaAlta: v } })} />
                        <SelectGroup
                            label="Estado"
                            value={socio.reprocann?.estado}
                            onChange={(v: any) => setSocio({ ...socio, reprocann: { ...socio.reprocann, estado: v } })}
                            options={[
                                { val: 'pendiente', label: 'Pendiente' },
                                { val: 'vigente', label: 'Vigente' },
                                { val: 'vencido', label: 'Vencido' },
                                { val: 'rechazado', label: 'Rechazado' },
                            ]}
                        />
                    </div>
                </div>
            </div>

            {/* EDIT MODAL */}
            {editingDocKey && currentDocConfig && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 100
                }}>
                    <div style={{
                        backgroundColor: 'hsl(var(--card))',
                        padding: '2rem',
                        borderRadius: 'var(--radius)',
                        width: '100%',
                        maxWidth: '500px',
                        border: '1px solid hsl(var(--border))',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Editar Documento</h3>
                            <button onClick={() => setEditingDocKey(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>

                        <div style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))' }}>
                            {docDefinitions.find(d => d.key === editingDocKey)?.label}
                        </div>

                        {/* Estado */}
                        <SelectGroup
                            label="Estado"
                            value={docForm.estado}
                            onChange={(v: any) => setDocForm({ ...docForm, estado: v })}
                            options={[
                                { val: 'pendiente', label: 'Pendiente' },
                                { val: 'completo', label: 'Completo' },
                                { val: 'vencido', label: 'Vencido' },
                            ]}
                        />

                        {/* Dates */}
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            {currentDocConfig.needsFecha && (
                                <InputGroup label="Fecha Emisión" type="date" value={docForm.fechaEmision} onChange={(v: string) => setDocForm({ ...docForm, fechaEmision: v })} />
                            )}
                            {currentDocConfig.hasExpiration && (
                                <InputGroup label="Fecha Vencimiento" type="date" value={docForm.fechaVencimiento} onChange={(v: string) => setDocForm({ ...docForm, fechaVencimiento: v })} />
                            )}
                        </div>

                        {/* Monto */}
                        {currentDocConfig.needsMonto && (
                            <InputGroup label="Monto ($)" type="number" value={docForm.monto} onChange={(v: string) => setDocForm({ ...docForm, monto: parseFloat(v) })} />
                        )}

                        {/* File Upload */}
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>Archivo (PDF/Imagen)</label>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input
                                    type="file"
                                    accept="application/pdf,image/*"
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                    style={{ fontSize: '0.9rem' }}
                                />
                            </div>
                            {docForm.archivoPath && !selectedFile && (
                                <p style={{ fontSize: '0.8rem', color: 'hsl(var(--primary))', marginTop: '0.3rem' }}>
                                    Documento actual cargado. Subir nuevo para reemplazar.
                                </p>
                            )}
                        </div>

                        {/* Observaciones */}
                        <InputGroup label="Observaciones" value={docForm.observaciones} onChange={(v: string) => setDocForm({ ...docForm, observaciones: v })} multiline />

                        {/* Buttons */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                            <button
                                onClick={() => setEditingDocKey(null)}
                                style={{
                                    padding: '0.75rem 1rem',
                                    backgroundColor: 'transparent',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveDoc}
                                disabled={uploading}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    backgroundColor: 'hsl(var(--primary))',
                                    color: 'hsl(var(--primary-foreground))',
                                    border: 'none',
                                    borderRadius: 'var(--radius)',
                                    cursor: 'pointer',
                                }}>
                                {uploading ? 'Subiendo...' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
