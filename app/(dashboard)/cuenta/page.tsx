"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { StorageService } from '@/services/storageService';
import { Pago, Pedido, Socio } from '@/types';
import { User, CreditCard, History, FileText, Activity, AlertCircle, FileCheck, CheckCircle, Clock, XCircle, ExternalLink, Upload, Plus, X } from 'lucide-react';

export default function CuentaPage() {
    const { user: authUser } = useAuth();
    const [socio, setSocio] = useState<Socio | null>(null);
    const [pagos, setPagos] = useState<Pago[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    
    // REPROCANN dates state for upload
    const [reprocannDates, setReprocannDates] = useState({
        fechaEmision: '',
        fechaVencimiento: ''
    });

    useEffect(() => {
        if (authUser) {
            async function fetchData() {
                try {
                    // Fetch fresh socio data to ensure we have the latest details
                    const socioData = await StoreService.getSocioById(authUser!.id) || authUser;
                    setSocio(socioData); // Fallback to authUser if not found (though it should be)

                    const pagosData = await StoreService.getPagosBySocio(authUser!.id);
                    setPagos(pagosData);
                } catch (error) {
                    console.error("Error fetching account data", error);
                } finally {
                    setLoading(false);
                }
            }
            fetchData();
        }
    }, [authUser]);

    if (!authUser) return null;

    if (loading) {
        return <div style={{ padding: '2rem' }}>Cargando información...</div>;
    }

    if (!socio) {
        return (
            <div style={{ padding: '2rem', color: 'red' }}>
                <AlertCircle /> No se pudo cargar la información del socio.
            </div>
        );
    }

    // Helper to format dates
    const formatDate = (dateString?: string) => {
        if (!dateString) return 'No informada';
        return new Date(dateString).toLocaleDateString('es-AR');
    };

    // Helper for Document Status Badge
    const DocumentStatusBadge = ({ status }: { status: string }) => {
        let color = 'hsl(var(--muted-foreground))';
        let bg = 'hsl(var(--muted))';
        let label = status;

        switch (status) {
            case 'completo':
            case 'vigente':
                color = '#10b981'; // emerald-500
                bg = '#ecfdf5'; // emerald-50
                label = 'Completo';
                break;
            case 'pendiente':
                color = '#f59e0b'; // amber-500
                bg = '#fffbeb'; // amber-50
                label = 'Pendiente';
                break;
            case 'vencido':
                color = '#ef4444'; // red-500
                bg = '#fef2f2'; // red-50
                label = 'Vencido';
                break;
            case 'en_revision':
                color = '#7c3aed'; // violet-600
                bg = '#f5f3ff'; // violet-50
                label = 'En Revisión';
                break;
            case 'rechazado':
                color = '#ef4444'; // red-500
                bg = '#fef2f2'; // red-50
                label = 'Rechazado';
                break;
            default:
                label = status || 'N/A';
        }

        return (
            <span style={{
                backgroundColor: bg,
                color: color,
                padding: '0.25rem 0.5rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
            }}>
                {label}
            </span>
        );
    };

    const SectionCard = ({ title, icon: Icon, children }: { title: string, icon: any, children: React.ReactNode }) => (
        <div style={{
            backgroundColor: 'hsl(var(--card))',
            borderRadius: 'var(--radius)',
            border: '1px solid hsl(var(--border))',
            padding: '1.5rem',
            height: '100%'
        }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', fontSize: '1.1rem', fontWeight: 600 }}>
                <Icon size={20} className="text-primary" />
                {title}
            </h3>
            {children}
        </div>
    );

    const InfoRow = ({ label, value }: { label: string, value: string | React.ReactNode }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0.5rem' }}>
            <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>{label}</span>
            <span style={{ fontWeight: 500, fontSize: '0.95rem', textAlign: 'right' }}>{value}</span>
        </div>
    );

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, tipo: string) => {
        const file = e.target.files?.[0];
        if (!file || !socio) return;

        setIsUploading(true);
        try {
            await StoreService.uploadDocumento(socio.id, tipo, file, 'socio_web');
            
            // If it's reprocann and dates are set, update metadata
            if (tipo === 'reprocann' && (reprocannDates.fechaEmision || reprocannDates.fechaVencimiento)) {
                // In a perfect world, uploadDocumento would take these.
                // For now, we update the doc record immediately after
                const docs = await StoreService.getDocumentosBySocio(socio.id);
                const reproDoc = docs.find(d => d.tipo === 'reprocann');
                if (reproDoc) {
                    await StoreService.upsertDocumentoSocio(socio.id, 'reprocann', {
                        fecha_emision: reprocannDates.fechaEmision || undefined,
                        fecha_vencimiento: reprocannDates.fechaVencimiento || undefined
                    });
                }
            }

            // Refresh data
            const freshSocio = await StoreService.getSocioById(socio.id);
            if (freshSocio) setSocio(freshSocio);
            setUploadingDoc(null);
            alert('Documento subido correctamente. Será revisado por administración.');
        } catch (err) {
            console.error(err);
            alert('Error al subir el documento.');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3rem' }}>
            {/* Upload Modal Overlay */}
            {uploadingDoc && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    backdropFilter: 'blur(4px)'
                }}>
                    <div style={{
                        backgroundColor: 'hsl(var(--background))',
                        padding: '2rem',
                        borderRadius: 'var(--radius)',
                        width: '90%',
                        maxWidth: '450px',
                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Subir {uploadingDoc.replace('_', ' ').toUpperCase()}</h2>
                            <button onClick={() => setUploadingDoc(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))' }}>
                                <X size={24} />
                            </button>
                        </div>

                        {uploadingDoc === 'reprocann' && (
                            <div style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 500 }}>Fecha de Emisión</label>
                                    <input 
                                        type="date" 
                                        value={reprocannDates.fechaEmision}
                                        onChange={(e) => setReprocannDates(prev => ({ ...prev, fechaEmision: e.target.value }))}
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 500 }}>Fecha de Vencimiento</label>
                                    <input 
                                        type="date" 
                                        value={reprocannDates.fechaVencimiento}
                                        onChange={(e) => setReprocannDates(prev => ({ ...prev, fechaVencimiento: e.target.value }))}
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid hsl(var(--border))' }}
                                    />
                                </div>
                            </div>
                        )}

                        <div style={{
                            border: '2px dashed hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                            padding: '2rem',
                            textAlign: 'center',
                            cursor: 'pointer',
                            position: 'relative',
                            transition: 'border-color 0.2s',
                        }}
                        onMouseOver={(e) => e.currentTarget.style.borderColor = 'hsl(var(--primary))'}
                        onMouseOut={(e) => e.currentTarget.style.borderColor = 'hsl(var(--border))'}
                        >
                            <input
                                type="file"
                                accept=".pdf,image/*"
                                onChange={(e) => handleFileUpload(e, uploadingDoc)}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    opacity: 0,
                                    cursor: 'pointer'
                                }}
                                disabled={isUploading}
                            />
                            {isUploading ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                    <Clock className="animate-spin" size={32} />
                                    <p>Subiendo archivo...</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                    <Upload size={32} style={{ color: 'hsl(var(--muted-foreground))' }} />
                                    <p style={{ fontWeight: 500 }}>Seleccionar archivo PDF o Imagen</p>
                                    <p style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>Hacé click o arrastrá el archivo aquí</p>
                                </div>
                            )}
                        </div>
                        
                        <div style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', backgroundColor: 'hsl(var(--muted))', padding: '0.75rem', borderRadius: 'var(--radius)' }}>
                            <AlertCircle size={14} style={{ display: 'inline', marginRight: '0.4rem' }} />
                            Asegurate de que el archivo sea legible. El administrador validará la información pronto.
                        </div>
                    </div>
                </div>
            )}

            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 700 }}>Mi Cuenta</h1>
                <p style={{ color: 'hsl(var(--muted-foreground))' }}>Información personal, trámites y estado de cuenta.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>

                {/* 1. Datos Personales */}
                <SectionCard title="Datos Personales" icon={User}>
                    <InfoRow label="Nombre Completo" value={`${socio.nombre} ${socio.apellido}`} />
                    <InfoRow label="DNI" value={socio.dni} />
                    <InfoRow label="Email" value={socio.email} />
                    <InfoRow label="Teléfono" value={socio.telefono} />
                    <InfoRow label="Fecha Nacimiento" value={formatDate(socio.fechaNacimiento)} />
                    <InfoRow label="Domicilio" value={socio.direccion || 'No informado'} />
                    <InfoRow label="Localidad" value={socio.localidad || 'No informado'} />
                </SectionCard>

                {/* 2. REPROCANN */}
                <SectionCard title="REPROCANN" icon={FileCheck}>
                    {socio.reprocann ? (
                        <>
                            <InfoRow label="Número de Trámite" value={socio.reprocann.numeroTramite || 'No informado'} />
                            <InfoRow label="Fecha de Alta" value={formatDate(socio.reprocann.fechaAlta)} />
                            <InfoRow label="Estado" value={<DocumentStatusBadge status={socio.reprocann.estado || 'Desconocido'} />} />
                            {socio.reprocann.estado === 'vencido' && (
                                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fef2f2', color: '#dc2626', borderRadius: 'var(--radius)', fontSize: '0.9rem' }}>
                                    <AlertCircle size={16} style={{ display: 'inline', marginRight: '0.5rem' }} />
                                    Tu REPROCANN está vencido. Por favor regularizá tu situación.
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ color: 'hsl(var(--muted-foreground))', textAlign: 'center', padding: '2rem 0' }}>
                            <p>Sin datos de REPROCANN cargados.</p>
                        </div>
                    )}
                </SectionCard>

                {/* 3. Médico Tratante */}
                <SectionCard title="Médico Tratante" icon={Activity}>
                    <InfoRow label="Médico" value={socio.medicoNombre || 'No informado'} />
                    <InfoRow label="Matrícula" value={socio.medicoMatricula || 'No informada'} />
                    <InfoRow label="Diagnóstico" value={socio.diagnosticoPrincipal || 'No informado'} />
                </SectionCard>

                {/* 4. Estado de Cuenta (Original) */}
                <SectionCard title="Estado de Cuota" icon={CreditCard}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <span>Última cuota paga:</span>
                        <span style={{ fontWeight: 600 }}>{socio.estadoCuenta?.ultimaCuotaPaga || 'N/A'}</span>
                    </div>
                    <div style={{
                        backgroundColor: 'hsl(var(--primary) / 0.1)',
                        color: 'hsl(var(--primary))',
                        padding: '1rem',
                        borderRadius: 'var(--radius)',
                        textAlign: 'center',
                        fontWeight: 600
                    }}>
                        Estás al día con tu cuota
                    </div>
                </SectionCard>

                {/* 5. Documentación */}
                <div style={{ gridColumn: '1 / -1' }}>
                    <SectionCard title="Documentación Presentada" icon={FileText}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                                        <th style={{ textAlign: 'left', padding: '0.75rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>Documento</th>
                                        <th style={{ textAlign: 'left', padding: '0.75rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>Estado</th>
                                        <th style={{ textAlign: 'left', padding: '0.75rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>Vencimiento</th>
                                        <th style={{ textAlign: 'left', padding: '0.75rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>Última Act.</th>
                                        <th style={{ textAlign: 'right', padding: '0.75rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>Acción</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { key: 'declaracionJurada', dbKey: 'declaracion_jurada', name: 'Declaración Jurada', data: socio.documentacion?.declaracionJurada },
                                        { key: 'consentimiento', dbKey: 'consentimiento', name: 'Consentimiento Informado', data: socio.documentacion?.consentimiento },
                                        { key: 'reprocann', dbKey: 'reprocann', name: 'Certificado de Reprocann', data: socio.documentacion?.reprocann },
                                    ].map((doc, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: 500 }}>{doc.name}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <DocumentStatusBadge status={doc.data?.estado || 'pendiente'} />
                                            </td>
                                            <td style={{ padding: '0.75rem', fontSize: '0.9rem' }}>
                                                {formatDate(doc.data?.fechaVencimiento)}
                                            </td>
                                            <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))' }}>
                                                {formatDate(doc.data?.fechaEmision)}
                                            </td>
                                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                    {doc.data?.archivoPath && (
                                                        <button
                                                            onClick={async () => {
                                                                const url = await StorageService.createSignedUrl(doc.data!.archivoPath!);
                                                                if (url) window.open(url, '_blank');
                                                                else alert('No se pudo generar el enlace.');
                                                            }}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                color: 'hsl(var(--primary))',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.25rem',
                                                                fontSize: '0.9rem'
                                                            }}
                                                        >
                                                            <ExternalLink size={16} /> Ver
                                                        </button>
                                                    )}
                                                    
                                                    {(!doc.data || doc.data.verificacion_estado === 'pendiente' || doc.data.verificacion_estado === 'rechazado') ? (
                                                        <button
                                                            onClick={() => setUploadingDoc(doc.dbKey)}
                                                            style={{
                                                                padding: '0.3rem 0.6rem',
                                                                borderRadius: 'var(--radius)',
                                                                backgroundColor: 'hsl(var(--secondary))',
                                                                border: '1px solid hsl(var(--border))',
                                                                fontSize: '0.8rem',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.3rem'
                                                            }}
                                                        >
                                                            <Upload size={14} /> {doc.data?.archivoPath ? 'Actualizar' : 'Subir'}
                                                        </button>
                                                    ) : (
                                                        <span style={{ 
                                                            fontSize: '0.75rem', 
                                                            color: 'hsl(var(--muted-foreground))',
                                                            fontStyle: 'italic',
                                                            display: 'flex',
                                                            alignItems: 'center'
                                                        }} title="Los documentos aprobados no pueden ser modificados.">
                                                            No editable
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </SectionCard>
                </div>

                {/* 6. Historial de Pagos (Original, slightly compacted) */}
                <div style={{ gridColumn: '1 / -1' }}>
                    <SectionCard title="Historial de Pagos" icon={History}>
                        {pagos.length === 0 ? (
                            <p style={{ color: 'hsl(var(--muted-foreground))' }}>No hay pagos registrados.</p>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
                                {pagos.map(pago => (
                                    <div key={pago.id} style={{
                                        padding: '1rem',
                                        border: '1px solid hsl(var(--border))',
                                        borderRadius: 'var(--radius)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem'
                                    }}>
                                        <div style={{ fontWeight: 600 }}>{pago.concepto}</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                                            <span style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>{pago.fecha}</span>
                                            <span style={{ alignSelf: 'flex-end', fontWeight: 700, color: 'hsl(var(--primary))' }}>${pago.monto}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>

            </div>
        </div>
    );
}
