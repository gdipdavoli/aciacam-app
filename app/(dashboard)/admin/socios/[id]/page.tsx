"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { NotificationService } from '@/services/notificationService';
import { StorageService } from '@/services/storageService';
import type { TipoDocumento, EstadoVerificacion } from '@/services/documentacionService';
import { Socio, Pedido, DocumentoSocio, DocumentacionSocio, EstadoDocumento, Pago, Notificacion } from '@/types';
import { ArrowLeft, Save, FileText, Activity, AlertTriangle, CheckCircle, Edit, ExternalLink, X, Upload, Plus, CreditCard, Send, Bell, MessageSquare } from 'lucide-react';

const DOC_CONFIG: Record<string, { needsFecha: boolean; needsMonto: boolean; hasExpiration: boolean }> = {
    consentimiento: { needsFecha: false, needsMonto: false, hasExpiration: false },
    declaracionJurada: { needsFecha: true, needsMonto: false, hasExpiration: false },
    reprocann: { needsFecha: true, needsMonto: false, hasExpiration: true },
    contrato_autocultivo: { needsFecha: true, needsMonto: true, hasExpiration: true },
    contrato_madre: { needsFecha: true, needsMonto: true, hasExpiration: true },
    contrato: { needsFecha: true, needsMonto: false, hasExpiration: true }
};

// --- HELPER COMPONENTS (Moved outside to prevent re-mounts) ---

const Section = ({ title, children, icon: Icon, actions, defaultOpen = false }: any) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <section className="bg-card border border-border rounded-lg mb-6 overflow-hidden">
            <div
                className="p-4 border-b border-border bg-muted flex items-center gap-2 cursor-pointer md:cursor-default"
                onClick={() => setIsOpen(!isOpen)}
            >
                {Icon && <Icon size={18} />}
                <h3 className="text-lg font-semibold flex-1">{title}</h3>

                {/* Mobile Chevron */}
                <div className="md:hidden text-muted-foreground">
                    {isOpen ? <div style={{ transform: 'rotate(180deg)' }}>▼</div> : <div>▼</div>}
                </div>

                {actions && <div className="ml-auto" onClick={e => e.stopPropagation()}>{actions}</div>}
            </div>
            {/* Content: Hidden on mobile unless open, Always visible on desktop */}
            <div className={`${isOpen ? 'block' : 'hidden'} md:block p-6 transition-all`}>
                {children}
            </div>
        </section>
    );
};

const InputGroup = ({ label, value, onChange, type = 'text', width = '100%', multiline = false, placeholder, readOnly = false }: any) => (
    <div style={{ marginBottom: '1rem', width }}>
        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>{label}</label>
        {multiline ? (
            <textarea
                value={value || ''}
                onChange={e => !readOnly && onChange(e.target.value)}
                placeholder={readOnly ? '' : placeholder}
                readOnly={readOnly}
                disabled={readOnly}
                style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: readOnly ? '1px dashed transparent' : '1px solid hsl(var(--border))',
                    borderRadius: '4px',
                    fontSize: '0.95rem',
                    minHeight: '80px',
                    fontFamily: 'inherit',
                    backgroundColor: readOnly ? 'rgba(0,0,0,0.02)' : 'transparent',
                    color: readOnly ? 'hsl(var(--foreground))' : 'inherit',
                    resize: readOnly ? 'none' : 'vertical'
                }}
            />
        ) : (
            <input
                type={type}
                value={value || ''}
                onChange={e => !readOnly && onChange(e.target.value)}
                placeholder={readOnly ? '' : placeholder}
                readOnly={readOnly}
                disabled={readOnly}
                style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: readOnly ? '1px dashed transparent' : '1px solid hsl(var(--border))',
                    borderRadius: '4px',
                    fontSize: '0.95rem',
                    backgroundColor: readOnly ? 'rgba(0,0,0,0.02)' : 'transparent',
                    color: readOnly ? 'hsl(var(--foreground))' : 'inherit'
                }}
            />
        )}
    </div>
);

const SelectGroup = ({ label, value, onChange, options, width = '100%', readOnly = false }: any) => (
    <div style={{ marginBottom: '1rem', width }}>
        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>{label}</label>
        <select
            value={value || ''}
            onChange={e => !readOnly && onChange(e.target.value)}
            disabled={readOnly}
            style={{
                width: '100%',
                padding: '0.5rem',
                border: readOnly ? '1px dashed transparent' : '1px solid hsl(var(--border))',
                borderRadius: '4px',
                fontSize: '0.95rem',
                backgroundColor: readOnly ? 'rgba(0,0,0,0.02)' : 'transparent',
                color: readOnly ? 'hsl(var(--foreground))' : 'inherit',
                appearance: readOnly ? 'none' : 'auto'
            }}
        >
            {options.map((opt: any) => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
        </select>
    </div>
);

const Pill = ({ status }: { status: string }) => {
    let color = '#374151';
    let bg = '#f3f4f6';

    const good = ['vigente', 'activo', 'completo', 'aprobado'];
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

// --- INVITE WIDGET COMPONENT ---
// --- INVITE WIDGET COMPONENT ---
// --- INVITE WIDGET COMPONENT ---
const InviteStatusWidget = ({ socioId, socioEmail, mode = 'full' }: { socioId: string, socioEmail: string, mode?: 'inline' | 'full' }) => {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [copying, setCopying] = useState(false);

    const fetchStatus = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/socios/${socioId}/invite-status`);
            if (res.ok) {
                setStatus(await res.json());
            } else {
                let errorMsg = `HTTP ${res.status}`;
                try {
                    const errBody = await res.json();
                    errorMsg = errBody.error || errorMsg;
                } catch (e) { /* ignore */ }
                setStatus({ error: errorMsg });
            }
        } catch (e: any) {
            console.error('Widget Fetch Error:', e);
            setStatus({ error: e.message || 'Fetch Error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, [socioId]);

    const handleInvite = async () => {
        if (!confirm(`¿Enviar invitación a ${socioEmail}?`)) return;
        setSending(true);
        try {
            // Updated to use the new Generic Invite API
            // Updated to use StoreService which handles Auth Headers
            await StoreService.inviteSocio(socioId);

            alert('Invitación enviada.');
            fetchStatus();
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setSending(false);
        }
    };

    const handleCopyLink = () => {
        if (!status?.latestInvite?.token) return;
        // Construct link assuming localhost or env var
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/activate?token=${status.latestInvite.token}`;
        navigator.clipboard.writeText(link).then(() => {
            setCopying(true);
            setTimeout(() => setCopying(false), 2000);
        });
    };

    if (loading && !status) return <span style={{ fontSize: '0.8rem', color: 'gray' }}>Cargando estado...</span>;

    if (status?.error) {
        return (
            <div style={{ color: 'red', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={14} /> <span>{status.error}</span>
                <button onClick={fetchStatus} style={{ marginLeft: '0.5rem', cursor: 'pointer', textDecoration: 'underline' }}>Reintentar</button>
            </div>
        );
    }

    if (!status) return <span style={{ fontSize: '0.8rem', color: 'gray' }}>Sin datos.</span>;

    // Logic
    const latest = status.latestInvite;
    const computed = latest?.computed_status; // sent, consumed, expired
    // If active -> socioActive is true
    const isActive = status.socioActive;
    const isExpired = !isActive && computed === 'expired';
    const isPending = !isActive && (computed === 'sent' || computed === 'created');
    const hasNoInvite = !isActive && !latest;

    // Label Logic
    let label = 'Desconocido';
    let badgeColor = 'gray'; // default
    let badgeBg = '#f3f4f6';

    if (isActive) {
        label = 'Activa';
        badgeColor = '#166534'; badgeBg = '#dcfce7';
    } else if (isExpired) {
        label = 'Expirada';
        badgeColor = '#991b1b'; badgeBg = '#fee2e2';
    } else if (computed === 'consumed') {
        // Should verify if consumed but not active? Likely impossible unless error.
        label = 'Consumida';
        badgeColor = '#166534'; badgeBg = '#dcfce7';
    } else if (isPending) {
        label = computed === 'sent' ? 'Enviada' : 'Pendiente';
        badgeColor = '#b45309'; badgeBg = '#ffedd5';
    } else {
        label = 'Sin Invitación';
    }

    // Date Logic
    const relevantDate = latest ? (latest.sent_at || latest.created_at) : null;

    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {isActive ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 600, color: '#166534' }}>Cuenta vinculada</span>
                            {status.passwordSet ? <span title="Password set">🔐</span> : <span title="No password">⚠️</span>}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '999px',
                                backgroundColor: badgeBg,
                                color: badgeColor,
                                fontSize: '0.75rem',
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                letterSpacing: '0.05em'
                            }}>
                                {label}
                            </span>
                        </div>
                    )}
                </div>

                {/* Subtext: Date or Details */}
                <div style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>
                    {isActive ? (
                        <span>UID: <code style={{ fontSize: '0.75rem', backgroundColor: 'rgba(0,0,0,0.05)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>{status.socioUserId?.substring(0, 8)}...</code></span>
                    ) : relevantDate ? (
                        <span>{isExpired ? 'Expiró el' : (computed === 'sent' ? 'Enviada el' : 'Creada el')} {new Date(relevantDate).toLocaleDateString()} a las {new Date(relevantDate).toLocaleTimeString().slice(0, 5)}</span>
                    ) : (
                        <span>Listo para invitar</span>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                {!isActive && (
                    <>
                        <button
                            onClick={handleInvite}
                            disabled={sending}
                            style={{
                                padding: '0.4rem 0.8rem',
                                backgroundColor: 'hsl(var(--primary))',
                                color: 'hsl(var(--primary-foreground))',
                                borderRadius: 'var(--radius)',
                                border: 'none',
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                opacity: sending ? 0.7 : 1,
                                display: 'flex', alignItems: 'center', gap: '0.5rem'
                            }}
                        >
                            {sending ? 'Procesando...' : (hasNoInvite ? 'Enviar invitación' : 'Reenviar')}
                        </button>

                        {!hasNoInvite && !isExpired && (
                            <button
                                onClick={handleCopyLink}
                                style={{
                                    padding: '0.4rem 0.8rem',
                                    backgroundColor: 'hsl(var(--secondary))',
                                    color: 'hsl(var(--secondary-foreground))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer'
                                }}
                            >
                                {copying ? 'Copiado!' : 'Copiar Link'}
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

// --- NEW COMPONENT: DocumentEditModal (Isolated State) ---
const DocumentEditModal = ({ docKey, docLabel, initialData, config, onClose, onSave, uploading }: any) => {
    // 1. Local State
    const [form, setForm] = useState<DocumentoSocio>(initialData || { verificacion_estado: 'pendiente' } as any);
    const [file, setFile] = useState<File | null>(null);
    const [isEditing, setIsEditing] = useState(false); // DEFAULT READ ONLY

    // 4. Verification Log
    useEffect(() => {
        console.log("MOUNT modal");
        return () => console.log("UNMOUNT modal");
    }, []);

    // Sync only on mount/key change
    useEffect(() => {
        if (initialData) {
            setForm(initialData);
        }
    }, [initialData]);

    const handleSave = () => {
        onSave(form, file);
    };

    const handleClose = () => {
        // Check dirty state
        const isDirty = JSON.stringify(form) !== JSON.stringify(initialData || { verificacion_estado: 'pendiente' }) || !!file;
        if (isEditing && isDirty) {
            if (window.confirm("Tenés cambios sin guardar. ¿Descartar?")) {
                onClose();
            }
        } else {
            onClose();
        }
    };

    return (
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
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Gestionar Documento</h3>
                    <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))' }}>
                    {docLabel}
                </div>

                {/* Edit Controls */}
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                    {!isEditing ? (
                        <button onClick={() => setIsEditing(true)} style={{ color: 'hsl(var(--primary))', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <Edit size={16} /> Habilitar Edición
                        </button>
                    ) : (
                        <span style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>Modo Edición Activo</span>
                    )}
                </div>

                {/* Verification Status */}
                <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', marginBottom: '1.5rem', border: '1px solid #e2e8f0' }}>
                    <SelectGroup
                        label="Estado de Verificación (Admin)"
                        value={form.verificacion_estado}
                        onChange={(v: any) => setForm({ ...form, verificacion_estado: v })}
                        options={[
                            { val: 'pendiente', label: 'Pendiente' },
                            { val: 'aprobado', label: 'Aprobado' },
                            { val: 'rechazado', label: 'Rechazado' },
                        ]}
                        readOnly={!isEditing}
                    />
                    <InputGroup label="Observaciones de Verificación" value={form.verificacion_obs} onChange={(v: string) => setForm({ ...form, verificacion_obs: v })} placeholder="Ej: Falta firma, fecha ilegible..." readOnly={!isEditing} />
                </div>

                {/* Dates */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                    {config.needsFecha && (
                        <InputGroup label="Fecha Emisión" type="date" value={form.fechaEmision} onChange={(v: string) => setForm({ ...form, fechaEmision: v })} readOnly={!isEditing} />
                    )}
                    {config.hasExpiration && (
                        <InputGroup label="Fecha Vencimiento" type="date" value={form.fechaVencimiento} onChange={(v: string) => setForm({ ...form, fechaVencimiento: v })} readOnly={!isEditing} />
                    )}
                </div>

                {/* Monto */}
                {config.needsMonto && (
                    <InputGroup label="Monto ($)" type="number" value={form.monto} onChange={(v: string) => setForm({ ...form, monto: parseFloat(v) })} readOnly={!isEditing} />
                )}

                {/* File Upload */}
                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>Archivo (PDF/Imagen)</label>

                    {isEditing && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                                type="file"
                                accept="application/pdf,image/*"
                                onChange={(e) => setFile(e.target.files?.[0] || null)}
                                style={{ fontSize: '0.9rem' }}
                            />
                        </div>
                    )}

                    {form.archivoPath && !file && (
                        <p style={{ fontSize: '0.8rem', color: 'hsl(var(--primary))', marginTop: '0.3rem' }}>
                            {isEditing ? 'Documento actual cargado. Subir nuevo para reemplazar.' : 'Documento adjunto presente.'}
                        </p>
                    )}
                </div>

                {/* General Observaciones */}
                <InputGroup label="Notas Internas" value={form.observaciones} onChange={(v: string) => setForm({ ...form, observaciones: v })} multiline readOnly={!isEditing} />

                {/* Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                    <button
                        onClick={handleClose}
                        style={{
                            padding: '0.75rem 1rem',
                            backgroundColor: 'transparent',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                            cursor: 'pointer'
                        }}
                    >
                        {isEditing ? 'Cancelar Edición' : 'Cerrar'}
                    </button>
                    {isEditing && (
                        <button
                            onClick={handleSave}
                            disabled={uploading}
                            style={{
                                padding: '0.75rem 1.5rem',
                                backgroundColor: 'hsl(var(--primary))',
                                color: 'hsl(var(--primary-foreground))',
                                border: 'none',
                                borderRadius: 'var(--radius)',
                                cursor: 'pointer',
                            }}>
                            {uploading ? 'Guardando...' : 'Guardar y Verificar'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default function SocioDetailsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [socio, setSocio] = useState<Socio | null>(null);
    const [originalSocio, setOriginalSocio] = useState<Socio | null>(null); // Snapshot for revert
    const [editingSection, setEditingSection] = useState<string | null>(null); // 'personal' | 'admin' | 'reprocann' | 'domicilio' | 'medico'

    const [orders, setOrders] = useState<Pedido[]>([]);
    const [pagos, setPagos] = useState<Pago[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // New Payment Form State
    const [showPagoForm, setShowPagoForm] = useState(false);
    const [newPago, setNewPago] = useState<Omit<Pago, 'id'>>({
        socioId: id,
        fecha: new Date().toISOString().split('T')[0],
        concepto: 'Cuota Mensual',
        monto: 5000,
        medioDePago: 'Transferencia'
    });
    const [registeringPago, setRegisteringPago] = useState(false);

    const [compliance, setCompliance] = useState<any>(null);
    const [editingDocKey, setEditingDocKey] = useState<keyof DocumentacionSocio | null>(null);
    // Removed docForm and selectedFile derived state from here; now handled in modal
    const [uploading, setUploading] = useState(false);



    const [docDefinitions, setDocDefinitions] = useState<{ key: string, label: string }[]>([
        { key: 'declaracionJurada', label: 'Declaración Jurada' },
        { key: 'consentimiento', label: 'Consentimiento Informado' },
        { key: 'reprocann', label: 'Certificado de Reprocann' },
    ]);

    // Update docDefinitions when socio changes to include non-standard documents
    useEffect(() => {
        if (!socio?.documentacion) return;
        
        const standardKeys = ['declaracionJurada', 'consentimiento', 'reprocann'];
        const existingDocs = Object.keys(socio.documentacion);
        
        const extraDocs = existingDocs
          .filter(k => !standardKeys.includes(k) && socio.documentacion?.[k])
          .map(k => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') }));

        setDocDefinitions(prev => {
          const base = [
            { key: 'declaracionJurada', label: 'Declaración Jurada' },
            { key: 'consentimiento', label: 'Consentimiento Informado' },
            { key: 'reprocann', label: 'Certificado de Reprocann' },
          ];
          // Merge avoiding duplicates
          const seen = new Set(base.map(b => b.key));
          const filteredExtra = extraDocs.filter(e => !seen.has(e.key));
          return [...base, ...filteredExtra];
        });
    }, [socio?.documentacion]);

    const currentDocConfig = editingDocKey ? (DOC_CONFIG[editingDocKey] || { needsFecha: true, needsMonto: false, hasExpiration: true }) : null;

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }

            Promise.all([
                StoreService.getSocioById(id),
                StoreService.getPedidosBySocio(id),
                StoreService.getPagosBySocio(id),
                StoreService.getDocumentosBySocio(id),
                fetch(`/api/socios/${id}/compliance`).then(res => res.ok ? res.json() : null)
            ]).then(([socioData, ordersData, pagosData, docsData, complianceData]) => {
                if (socioData) {
                    // Map docs from array to Record
                    const mappedDocs: Record<string, DocumentoSocio> = {};
                    docsData.forEach(d => {
                      mappedDocs[d.tipo] = {
                        estado: d.estado as EstadoDocumento,
                        archivoPath: d.archivo_path || undefined,
                        fechaEmision: d.fecha_emision || undefined,
                        fechaVencimiento: d.fecha_vencimiento || undefined,
                        monto: d.monto || undefined,
                        observaciones: d.observaciones || undefined,
                        verificacion_estado: d.verificacion_estado,
                        verificacion_obs: d.verificacion_obs || undefined,
                        verificado_at: d.verificado_at || undefined,
                        verificado_por: d.verificado_por || undefined
                      };
                    });

                    // Initialize nested objects
                    const initializedSocio = {
                        ...socioData,
                        reprocann: socioData.reprocann || { estado: 'pendiente' },
                        documentacion: {
                            ...socioData.documentacion,
                            ...mappedDocs
                        }
                    };
                    setSocio(initializedSocio);
                    setOriginalSocio(JSON.parse(JSON.stringify(initializedSocio))); // Deep copy for snapshot
                    setOrders(ordersData.sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()));
                    setPagos(pagosData);
                    setCompliance(complianceData);
                }
                setLoading(false);
            });
        }
    }, [user, authLoading, router, id]);

    const handleCancelEdit = () => {
        if (!originalSocio || !editingSection) return;

        // Dirty check before cancel? (Optional, but user requested 'Cancelar revierte todo')
        // For simplicity, we just revert immediately on Cancel.

        setSocio(JSON.parse(JSON.stringify(originalSocio))); // Revert to original
        setEditingSection(null);
    };

    const handleSaveSection = async () => {
        if (!socio) return;
        setSaving(true);
        try {
            await StoreService.updateSocio(socio.id, socio);
            setOriginalSocio(JSON.parse(JSON.stringify(socio))); // Update snapshot
            setEditingSection(null);
            alert('Cambios guardados correctamente');
        } catch (error) {
            console.error(error);
            alert('Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    // --- Section Action Buttons Helper ---
    const SectionEditActions = ({ sectionKey }: { sectionKey: string }) => {
        const isEditingThis = editingSection === sectionKey;
        const isEditingOther = editingSection !== null && editingSection !== sectionKey;

        if (!isEditingThis) {
            return (
                <button
                    onClick={() => setEditingSection(sectionKey)}
                    disabled={isEditingOther}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.85rem',
                        color: isEditingOther ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                        backgroundColor: isEditingOther ? 'transparent' : 'hsl(var(--secondary))',
                        border: isEditingOther ? 'none' : '1px solid hsl(var(--border))',
                        padding: '0.35rem 0.8rem',
                        borderRadius: 'var(--radius)',
                        cursor: isEditingOther ? 'not-allowed' : 'pointer',
                        fontWeight: 500,
                        transition: 'all 0.2s',
                        opacity: isEditingOther ? 0.5 : 1
                    }}>
                    <Edit size={14} /> Editar
                </button>
            );
        }

        return (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                    onClick={handleCancelEdit}
                    style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: '0.35rem 0.8rem' }}>
                    Cancelar
                </button>
                <button
                    onClick={handleSaveSection}
                    disabled={saving}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.85rem',
                        color: 'hsl(var(--primary-foreground))',
                        backgroundColor: 'hsl(var(--primary))',
                        border: 'none',
                        borderRadius: 'var(--radius)',
                        padding: '0.35rem 0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                    }}>
                    <Save size={14} />
                    {saving ? 'Guardando...' : 'Guardar'}
                </button>
            </div>
        );
    }

    const handleEditDoc = (key: keyof DocumentacionSocio, doc: DocumentoSocio | undefined) => {
        setEditingDocKey(key);
        // Note: No need to set docForm here anymore, the modal will initialize with `socio.documentacion[key]`
    };

    const handleSaveDoc = async (formData: DocumentoSocio, file: File | null) => {
        if (!socio || !editingDocKey) return;

        const docKeyToTipo: Record<string, string> = {
            'declaracionJurada': 'declaracionJurada', // Fixed to match compliance and keys
            'consentimiento': 'consentimiento',
            'reprocann': 'reprocann',
            'contrato_autocultivo': 'contrato_autocultivo',
            'contrato_madre': 'contrato_madre',
            'contrato': 'contrato'
        };

        const tipo = docKeyToTipo[editingDocKey] || editingDocKey;

        setUploading(true);
        try {
            let newPath = formData.archivoPath;

            if (file) {
                const uploadResult = await StorageService.uploadSocioDocument({
                    socioId: socio.id,
                    file: file,
                    docType: editingDocKey as string
                });
                newPath = uploadResult.path;
            }

            const newDocData: DocumentoSocio = {
                ...formData,
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

            // 1. Save Verification/Metadata to Real DB (Internal API)
            // This is actually redundant if we use upsertDocumentoSocio correctly, but keeping for compatibility
            await fetch(`/api/socios/${socio.id}/documents/${tipo}/verificacion`, {
                method: 'PATCH',
                body: JSON.stringify({
                    verificacion_estado: formData.verificacion_estado,
                    verificacion_obs: formData.verificacion_obs,
                    verificado_por: user?.email || 'admin'
                })
            });

            // 2. Save to Store (DB Persistence via Service) - NOW PASSING ALL FIELDS
            await StoreService.upsertDocumentoSocio(
             socio.id,
             tipo as TipoDocumento,
             {
               verificacion_estado: formData.verificacion_estado as EstadoVerificacion,
               verificacion_obs: formData.verificacion_obs,
               archivo_path: newPath,
               fecha_emision: formData.fechaEmision,
               fecha_vencimiento: formData.fechaVencimiento,
               monto: formData.monto,
               observaciones: formData.observaciones,
               uploaded_by: 'admin'
             }
            );

            setEditingDocKey(null);
            
            // If it was reprocann, sync back to flat fields if needed
            if (tipo === 'reprocann' && formData.fechaVencimiento) {
                await StoreService.updateSocio(socio.id, {
                    reprocann: {
                        ...socio.reprocann,
                        fechaAlta: formData.fechaEmision,
                        estado: (formData.verificacion_estado === 'aprobado' ? 'vigente' : 'pendiente') as any
                    }
                });
            }

            // Refresh compliance data
            fetch(`/api/socios/${id}/compliance`).then(res => res.ok ? res.json() : null).then(setCompliance);

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

    const handleRegisterPago = async () => {
        if (!user) return;
        setRegisteringPago(true);
        try {
            const result = await StoreService.createPago(newPago, user.id);
            setPagos([result, ...pagos]);
            setShowPagoForm(false);
            alert('Pago registrado con éxito');
            // Reset form
            setNewPago({
                socioId: id,
                fecha: new Date().toISOString().split('T')[0],
                concepto: 'Cuota Mensual',
                monto: 5000,
                medioDePago: 'Transferencia'
            });
        } catch (e: any) {
            alert('Error al registrar pago: ' + e.message);
        } finally {
            setRegisteringPago(false);
        }
    };

    if (loading || authLoading) return <div style={{ padding: '2rem' }}>Cargando ficha...</div>;
    if (!socio) return <div style={{ padding: '2rem' }}>Socio no encontrado.</div>;



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

                    {user?.rol === 'admin' && (
                        <button
                            onClick={async () => {
                                if (!confirm("PELIGRO: ¿Estás seguro de ELIMINAR este socio definitivamente? Se borrará su usuario y datos. Esta acción no se puede deshacer.")) return;

                                const promptEmail = prompt("Para confirmar, escribí el EMAIL del socio a eliminar:");
                                if (promptEmail !== socio.email) {
                                    alert("Email incorrecto. Cancelando.");
                                    return;
                                }

                                try {
                                    const { data: { session } } = await import('@/services/supabaseClient').then(m => m.supabase!.auth.getSession());
                                    if (!session) throw new Error("No session");

                                    const res = await fetch(`/api/admin/socios/${socio.id}`, {
                                        method: 'DELETE',
                                        headers: {
                                            'Authorization': `Bearer ${session.access_token}`
                                        }
                                    });

                                    if (res.ok) {
                                        alert("Socio eliminado correctamente.");
                                        router.replace('/admin/socios');
                                    } else {
                                        const err = await res.json();
                                        throw new Error(err.error || "Error desconocido");
                                    }
                                } catch (e: any) {
                                    alert("Error al eliminar: " + e.message);
                                }
                            }}
                            style={{
                                backgroundColor: '#fee2e2',
                                color: '#991b1b',
                                border: '1px solid #f87171',
                                padding: '0.4rem 0.8rem',
                                borderRadius: 'var(--radius)',
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                fontWeight: 600
                            }}
                        >
                            Eliminar Socio
                        </button>
                    )}

                    <div style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>
                        {editingSection ? 'Modo Edición Activo' : 'Modo Lectura'}
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem' }}>

                {/* Left Column (Main Info) */}
                <div style={{ gridColumn: 'span 8' }}>

                    <Section title="Cuenta de Usuario">
                        <InviteStatusWidget socioId={socio.id} socioEmail={socio.email} mode="full" />
                    </Section>


                    {/* SECCION B: Datos Personales */}
                    <Section title="Datos Personales" actions={<SectionEditActions sectionKey="personal" />}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Nombre" value={socio.nombre} onChange={(v: string) => setSocio({ ...socio, nombre: v })} readOnly={editingSection !== 'personal'} />
                            <InputGroup label="Apellido" value={socio.apellido} onChange={(v: string) => setSocio({ ...socio, apellido: v })} readOnly={editingSection !== 'personal'} />
                            <InputGroup label="DNI" value={socio.dni} onChange={(v: string) => setSocio({ ...socio, dni: v })} readOnly={editingSection !== 'personal'} />
                            <InputGroup label="Fecha Nacimiento" type="date" value={socio.fechaNacimiento} onChange={(v: string) => setSocio({ ...socio, fechaNacimiento: v })} readOnly={editingSection !== 'personal'} />
                            <InputGroup label="Teléfono" value={socio.telefono} onChange={(v: string) => setSocio({ ...socio, telefono: v })} readOnly={editingSection !== 'personal'} />
                            <InputGroup label="Email" value={socio.email} onChange={(v: string) => setSocio({ ...socio, email: v })} readOnly={editingSection !== 'personal'} />
                        </div>
                    </Section>

                    {/* SECCION Docs: Documentación */}

                    {/* NEW Compliance Section */}
                    {compliance && (
                        <div style={{
                            backgroundColor: 'hsl(var(--card))',
                            borderRadius: 'var(--radius)',
                            border: '1px solid hsl(var(--border))',
                            marginBottom: '1.5rem',
                            padding: '1rem 1.5rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <FileText size={18} /> Compliance Status
                                </h3>
                                <div>
                                    {compliance.completo ? (
                                        <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '0.3rem 0.8rem', borderRadius: '99px', fontSize: '0.8rem', fontWeight: 700 }}>
                                            COMPLETO
                                        </span>
                                    ) : (
                                        <span style={{ backgroundColor: '#ffedd5', color: '#b45309', padding: '0.3rem 0.8rem', borderRadius: '99px', fontSize: '0.8rem', fontWeight: 700 }}>
                                            INCOMPLETO ({compliance.faltantes.length})
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' }}>
                                {compliance.documentos_requeridos.map((req: string) => {
                                    const isPresent = compliance.documentos_presentes.includes(req);
                                    return (
                                        <div key={req} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                                            {isPresent ? <CheckCircle size={16} color="#22c55e" /> : <X size={16} color="#ef4444" />}
                                            <span style={{ color: isPresent ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>
                                                {req.replace('_', ' ').toUpperCase()}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    <Section 
                        title="Documentación Presentada" 
                        icon={FileText}
                        actions={
                            <button
                                onClick={() => {
                                    const name = window.prompt("Nombre del nuevo tipo de documento:");
                                    if (name) {
                                        const key = name.toLowerCase().replace(/\s+/g, '_');
                                        handleEditDoc(key, { verificacion_estado: 'pendiente' } as any);
                                    }
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    fontSize: '0.85rem',
                                    color: 'hsl(var(--foreground))',
                                    backgroundColor: 'hsl(var(--secondary))',
                                    border: '1px solid hsl(var(--border))',
                                    padding: '0.35rem 0.8rem',
                                    borderRadius: 'var(--radius)',
                                    cursor: 'pointer',
                                    fontWeight: 500
                                }}>
                                <Plus size={14} /> Agregar Documento
                            </button>
                        }
                    >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid hsl(var(--border))', textAlign: 'left', color: 'hsl(var(--muted-foreground))' }}>
                                    <th style={{ padding: '0.75rem' }}>Documento</th>
                                    <th style={{ padding: '0.75rem' }}>Adjunto</th>
                                    <th style={{ padding: '0.75rem' }}>Verificación</th>
                                    <th style={{ padding: '0.75rem' }}>Vencimiento</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'right' }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {docDefinitions.map(def => {
                                    const doc = socio.documentacion?.[def.key];
                                    const hasFile = !!doc?.archivoPath;
                                    return (
                                        <tr key={def.key} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: 500 }}>{def.label}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {hasFile ? <CheckCircle size={18} color="#22c55e" /> : <X size={18} color="#9ca3af" />}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <Pill status={doc?.verificacion_estado || 'pendiente'} />
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
                                                    title="Gestionar"
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
                    <Section title="Médico Tratante y Diagnóstico" icon={Activity} actions={<SectionEditActions sectionKey="medico" />}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Nombre del Médico" value={socio.medicoNombre} onChange={(v: string) => setSocio({ ...socio, medicoNombre: v })} readOnly={editingSection !== 'medico'} />
                            <InputGroup label="Matrícula" value={socio.medicoMatricula} onChange={(v: string) => setSocio({ ...socio, medicoMatricula: v })} readOnly={editingSection !== 'medico'} />
                        </div>
                        <InputGroup label="Diagnóstico Principal" value={socio.diagnosticoPrincipal} onChange={(v: string) => setSocio({ ...socio, diagnosticoPrincipal: v })} multiline readOnly={editingSection !== 'medico'} />
                    </Section>

                    {/* SECCION D: Domicilio */}
                    <Section title="Domicilio" actions={<SectionEditActions sectionKey="domicilio" />}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Calle y Número" value={socio.direccion} onChange={(v: string) => setSocio({ ...socio, direccion: v })} readOnly={editingSection !== 'domicilio'} />
                            <InputGroup label="Localidad" value={socio.localidad} onChange={(v: string) => setSocio({ ...socio, localidad: v })} readOnly={editingSection !== 'domicilio'} />
                            <InputGroup label="Provincia" value={socio.provincia} onChange={(v: string) => setSocio({ ...socio, provincia: v })} readOnly={editingSection !== 'domicilio'} />
                        </div>
                    </Section>

                    <Section
                        title={`Pedidos Asociados (${orders.length})`}
                        actions={
                            <button
                                onClick={() => router.push(`/admin/orders/new?socioId=${socio.id}`)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    fontSize: '0.85rem',
                                    color: 'hsl(var(--primary-foreground))',
                                    backgroundColor: 'hsl(var(--primary))',
                                    border: 'none',
                                    borderRadius: 'var(--radius)',
                                    padding: '0.35rem 0.8rem',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}>
                                <Plus size={14} /> Nueva Dispensa
                            </button>
                        }
                    >
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

                    <Section
                        title={`Historial de Pagos (${pagos.length})`}
                        icon={CreditCard}
                        actions={
                            <button
                                onClick={() => setShowPagoForm(!showPagoForm)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    fontSize: '0.85rem',
                                    color: 'hsl(var(--primary-foreground))',
                                    backgroundColor: 'hsl(var(--primary))',
                                    border: 'none',
                                    borderRadius: 'var(--radius)',
                                    padding: '0.35rem 0.8rem',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}>
                                <Plus size={14} /> Registrar Pago
                            </button>
                        }
                    >
                        {showPagoForm && (
                            <div style={{
                                marginBottom: '1.5rem',
                                padding: '1rem',
                                backgroundColor: 'hsl(var(--muted) / 0.5)',
                                borderRadius: 'var(--radius)',
                                border: '1px solid hsl(var(--border))'
                            }}>
                                <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>Saldar Cuota / Registrar nuevo pago</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <InputGroup label="Fecha" type="date" value={newPago.fecha} onChange={(v: string) => setNewPago({ ...newPago, fecha: v })} />
                                    <InputGroup label="Concepto" value={newPago.concepto} onChange={(v: string) => setNewPago({ ...newPago, concepto: v })} />
                                    <InputGroup label="Monto ($)" type="number" value={newPago.monto} onChange={(v: string) => setNewPago({ ...newPago, monto: parseFloat(v) })} />
                                    <SelectGroup
                                        label="Medio de Pago"
                                        value={newPago.medioDePago}
                                        onChange={(v: string) => setNewPago({ ...newPago, medioDePago: v })}
                                        options={[
                                            { val: 'Transferencia', label: 'Transferencia' },
                                            { val: 'Efectivo', label: 'Efectivo' },
                                            { val: 'Mercado Pago', label: 'Mercado Pago' },
                                            { val: 'Otro', label: 'Otro' },
                                        ]}
                                    />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                                    <button onClick={() => setShowPagoForm(false)} style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
                                    <button
                                        onClick={handleRegisterPago}
                                        disabled={registeringPago}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            backgroundColor: 'hsl(var(--primary))',
                                            color: 'hsl(var(--primary-foreground))',
                                            border: 'none',
                                            borderRadius: 'var(--radius)',
                                            fontSize: '0.85rem',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {registeringPago ? 'Registrando...' : 'Confirmar Pago'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid hsl(var(--border))', textAlign: 'left', color: 'hsl(var(--muted-foreground))' }}>
                                    <th style={{ padding: '0.75rem 0' }}>Fecha</th>
                                    <th style={{ padding: '0.75rem 0' }}>Concepto</th>
                                    <th style={{ padding: '0.75rem 0' }}>Medio</th>
                                    <th style={{ padding: '0.75rem 0', textAlign: 'right' }}>Monto</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagos.length === 0 ? (
                                    <tr><td colSpan={4} style={{ padding: '1rem', color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>No hay pagos registrados</td></tr>
                                ) : (
                                    pagos.map(pago => (
                                        <tr key={pago.id} style={{ borderBottom: '1px dashed hsl(var(--border))' }}>
                                            <td style={{ padding: '0.75rem 0' }}>{new Date(pago.fecha).toLocaleDateString()}</td>
                                            <td style={{ padding: '0.75rem 0' }}>{pago.concepto}</td>
                                            <td style={{ padding: '0.75rem 0' }}>{pago.medioDePago}</td>
                                            <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: 'hsl(var(--primary))' }}>${pago.monto}</td>
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
                    <Section title="Administración" icon={Activity} actions={<SectionEditActions sectionKey="admin" />}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <InputGroup
                                label="Nº Orden Libro"
                                type="number"
                                value={editingSection === 'admin' ? socio.ordenLibro : socio.ordenLibro}
                                onChange={(v: string) => setSocio({ ...socio, ordenLibro: parseInt(v) })}
                                readOnly={editingSection !== 'admin'}
                            />
                            <InputGroup
                                label="Nº Acta"
                                type="number"
                                value={editingSection === 'admin' ? socio.actaNumero : socio.actaNumero}
                                onChange={(v: string) => setSocio({ ...socio, actaNumero: parseInt(v) })}
                                readOnly={editingSection !== 'admin'}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                <InputGroup
                                    label="Fecha Ingreso"
                                    type="date"
                                    value={editingSection === 'admin' ? socio.fechaIngresoOng : socio.fechaIngresoOng}
                                    onChange={(v: string) => setSocio({ ...socio, fechaIngresoOng: v })}
                                    readOnly={editingSection !== 'admin'}
                                    width="50%"
                                />
                                {user?.rol === 'admin' && (
                                    <SelectGroup
                                        label="Rol del Usuario"
                                        value={socio.rol}
                                        onChange={(v: any) => setSocio({ ...socio, rol: v })}
                                        options={[
                                            { val: 'socio', label: 'Socio (Cliente)' },
                                            { val: 'staff', label: 'Staff' },
                                            { val: 'admin', label: 'Administrador' }
                                        ]}
                                        readOnly={editingSection !== 'admin'}
                                        width="50%"
                                    />
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <SelectGroup
                                    label="Estado"
                                    value={socio.status}
                                    onChange={(v: any) => setSocio({ ...socio, status: v })}
                                    options={[{ val: 'active', label: 'AC' }, { val: 'suspended', label: 'SU' }]}
                                    readOnly={true}
                                    width="50%"
                                />
                                <SelectGroup
                                    label="Activo"
                                    value={socio.activo ? 'si' : 'no'}
                                    onChange={(v: string) => setSocio({ ...socio, activo: v === 'si' })}
                                    options={[{ val: 'si', label: 'Sí' }, { val: 'no', label: 'No' }]}
                                    readOnly={editingSection !== 'admin'}
                                    width="50%"
                                />
                            </div>
                        </div>

                        {/* Delivery Toggle */}
                        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: editingSection === 'admin' ? 'hsl(var(--background))' : 'transparent', border: editingSection === 'admin' ? '1px solid hsl(var(--border))' : 'none', borderRadius: 'var(--radius)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: editingSection === 'admin' ? 'pointer' : 'default' }}>
                                <input
                                    type="checkbox"
                                    checked={socio.envios_habilitados || false}
                                    onChange={(e) => setSocio({ ...socio, envios_habilitados: e.target.checked })}
                                    disabled={editingSection !== 'admin'}
                                    style={{ transform: 'scale(1.2)' }}
                                />
                                <div>
                                    <span style={{ display: 'block', fontWeight: 600 }}>Habilitar Envíos a Domicilio</span>
                                    <span style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>
                                        Permite al socio solicitar delivery (costo a cargo del socio).
                                    </span>
                                </div>
                            </label>
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
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#15803d', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 0 }}>
                            <CheckCircle size={18} /> REPROCANN
                        </h3>
                        <div style={{ marginLeft: 'auto' }}>
                            {editingSection !== 'reprocann' ? (
                                <button
                                    onClick={() => setEditingSection('reprocann')}
                                    disabled={editingSection !== null}
                                    style={{ fontSize: '0.85rem', color: editingSection ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))', background: 'none', border: 'none', cursor: editingSection ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                                    Editar
                                </button>
                            ) : (
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button onClick={handleCancelEdit} style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
                                    <button onClick={handleSaveSection} style={{ fontSize: '0.85rem', color: 'hsl(var(--primary))', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>Guardar</button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <InputGroup label="Nº Trámite" value={socio.reprocann?.numeroTramite} onChange={(v: string) => setSocio({ ...socio, reprocann: { ...socio.reprocann, numeroTramite: v } })} readOnly={editingSection !== 'reprocann'} />
                        <InputGroup label="Fecha Alta" type="date" value={socio.reprocann?.fechaAlta} onChange={(v: string) => setSocio({ ...socio, reprocann: { ...socio.reprocann, fechaAlta: v } })} readOnly={editingSection !== 'reprocann'} />
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
                            readOnly={editingSection !== 'reprocann'}
                        />
                    </div>
                </div>
            </div>

            {/* EDIT MODAL */}
            {
                editingDocKey && currentDocConfig && (
                    <DocumentEditModal
                        docKey={editingDocKey}
                        docLabel={docDefinitions.find(d => d.key === editingDocKey)?.label}
                        initialData={socio.documentacion?.[editingDocKey]}
                        config={currentDocConfig}
                        onClose={() => setEditingDocKey(null)}
                        onSave={handleSaveDoc}
                        uploading={uploading}
                    />
                )
            }
        </div >
    );
}
