"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Socio, Pedido, DocumentoSocio, DocumentacionSocio, EstadoContrato, ReprocannInfo } from '@/types';
import { ArrowLeft, Save, FileText, Activity, AlertTriangle, CheckCircle } from 'lucide-react';

export default function SocioDetailsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [socio, setSocio] = useState<Socio | null>(null);
    const [orders, setOrders] = useState<Pedido[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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
                            contrato: socioData.documentacion?.contrato || { estado: 'pendiente', estadoContrato: 'sin_contrato' }
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
            // Ensure numeric/string types are correct before saving if needed, but TS handles checks mostly.
            await StoreService.updateSocio(socio.id, socio);
            alert('Cambios guardados correctamente');
        } catch (error) {
            console.error(error);
            alert('Error al guardar');
        } finally {
            setSaving(false);
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

    const InputGroup = ({ label, value, onChange, type = 'text', width = '100%', multiline = false }: any) => (
        <div style={{ marginBottom: '1rem', width }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>{label}</label>
            {multiline ? (
                <textarea
                    value={value || ''}
                    onChange={e => onChange(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid hsl(var(--border))', borderRadius: '4px', fontSize: '0.95rem', minHeight: '80px', fontFamily: 'inherit' }}
                />
            ) : (
                <input
                    type={type}
                    value={value || ''}
                    onChange={e => onChange(e.target.value)}
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

    const Pill = ({ status, type }: { status: string, type: 'reprocann' | 'contrato' }) => {
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
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                fontWeight: 600,
                letterSpacing: '0.05em'
            }}>
                {status?.replace('_', ' ') || 'SIN DATOS'}
            </span>
        );
    };

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
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>REPROCANN</span>
                            <Pill status={socio.reprocann?.estado || 'pendiente'} type="reprocann" />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>CONTRATO</span>
                            <Pill status={socio.documentacion?.contrato?.estadoContrato || 'sin_contrato'} type="contrato" />
                        </div>
                    </div>

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

                    {/* SECCION D: Domicilio */}
                    <Section title="Domicilio">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Calle y Número (Domicilio)" value={socio.direccion} onChange={(v: string) => setSocio({ ...socio, direccion: v })} />
                            <InputGroup label="Localidad / Ciudad" value={socio.localidad} onChange={(v: string) => setSocio({ ...socio, localidad: v })} />
                            <InputGroup label="Provincia" value={socio.provincia} onChange={(v: string) => setSocio({ ...socio, provincia: v })} />
                        </div>
                    </Section>

                    {/* SECCION G: Médico y Diagnóstico */}
                    <Section title="Médico Tratante y Diagnóstico" icon={Activity}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                            <InputGroup label="Nombre del Médico" value={socio.medicoNombre} onChange={(v: string) => setSocio({ ...socio, medicoNombre: v })} />
                            <InputGroup label="Matrícula" value={socio.medicoMatricula} onChange={(v: string) => setSocio({ ...socio, medicoMatricula: v })} />
                        </div>
                        <InputGroup label="Diagnóstico Principal" value={socio.diagnosticoPrincipal} onChange={(v: string) => setSocio({ ...socio, diagnosticoPrincipal: v })} multiline />
                    </Section>

                    {/* SECCION I: Pedidos */}
                    <Section title={`Pedidos Asociados (${orders.length})`}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid hsl(var(--border))', textAlign: 'left', color: 'hsl(var(--muted-foreground))' }}>
                                    <th style={{ padding: '0.5rem' }}>ID</th>
                                    <th style={{ padding: '0.5rem' }}>Fecha</th>
                                    <th style={{ padding: '0.5rem' }}>Tipo</th>
                                    <th style={{ padding: '0.5rem' }}>Estado</th>
                                    <th style={{ padding: '0.5rem' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {orders.map(order => (
                                    <tr key={order.id} style={{ borderBottom: '1px dashed hsl(var(--border))' }}>
                                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>#{order.id.slice(-6)}</td>
                                        <td style={{ padding: '0.75rem 0.5rem' }}>{new Date(order.fechaCreacion).toLocaleDateString()}</td>
                                        <td style={{ padding: '0.75rem 0.5rem' }}>{order.tipoPedido === 'delivery' ? 'Delivery' : 'Retiro'}</td>
                                        <td style={{ padding: '0.75rem 0.5rem' }}>
                                            <span style={{
                                                textTransform: 'capitalize',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                backgroundColor: order.estado === 'pendiente' ? '#fef3c7' : '#dcfce7',
                                                color: order.estado === 'pendiente' ? '#92400e' : '#166534',
                                                fontSize: '0.8rem'
                                            }}>
                                                {order.estado}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                                            <a href={`/admin/orders/${order.id}`} style={{ color: 'hsl(var(--primary))', textDecoration: 'none', fontWeight: 500 }}>Ver</a>
                                        </td>
                                    </tr>
                                ))}
                                {orders.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '1rem', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>Sin pedidos recientes</td>
                                    </tr>
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

                    {/* SECCION F: Contrato */}
                    <div style={{
                        backgroundColor: '#fff',
                        border: '1px solid #f97316',
                        borderRadius: 'var(--radius)',
                        padding: '1.5rem',
                        boxShadow: '0 4px 6px -1px rgba(249, 115, 22, 0.1)'
                    }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <FileText size={18} /> Contrato de Cultivo
                        </h3>
                        <SelectGroup
                            label="Estado Contrato"
                            value={socio.documentacion?.contrato?.estadoContrato}
                            onChange={(v: any) => setSocio({ ...socio, documentacion: { ...socio.documentacion, contrato: { ...socio.documentacion?.contrato, estado: socio.documentacion?.contrato?.estado || 'pendiente', estadoContrato: v } } })}
                            options={[
                                { val: 'sin_contrato', label: 'Sin Contrato' },
                                { val: 'activo', label: 'Activo' },
                                { val: 'vencido', label: 'Vencido' },
                                { val: 'rescindido', label: 'Rescindido' },
                            ]}
                        />
                        <SelectGroup
                            label="Documento Físico"
                            value={socio.documentacion?.contrato?.estado}
                            onChange={(v: any) => setSocio({ ...socio, documentacion: { ...socio.documentacion, contrato: { ...socio.documentacion?.contrato, estadoContrato: socio.documentacion?.contrato?.estadoContrato || 'sin_contrato', estado: v } } })}
                            options={[
                                { val: 'pendiente', label: 'Pendiente' },
                                { val: 'completo', label: 'Completo' },
                                { val: 'vencido', label: 'Vencido' },
                            ]}
                        />
                        <InputGroup
                            label="Vencimiento"
                            type="date"
                            value={socio.documentacion?.contrato?.fechaVencimiento}
                            onChange={(v: string) => setSocio({ ...socio, documentacion: { ...socio.documentacion, contrato: { ...socio.documentacion?.contrato, estado: socio.documentacion?.contrato?.estado || 'pendiente', estadoContrato: socio.documentacion?.contrato?.estadoContrato || 'sin_contrato', fechaVencimiento: v } } })}
                        />
                    </div>

                    {/* SECCION F (Sub): Otra Docs */}
                    <Section title="Otros Documentos">
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Consentimiento Informado</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                            <SelectGroup
                                label="Estado"
                                value={socio.documentacion?.consentimiento?.estado || 'pendiente'}
                                onChange={(v: any) => setSocio({ ...socio, documentacion: { ...socio.documentacion, consentimiento: { ...socio.documentacion?.consentimiento, estado: v } } })}
                                options={[{ val: 'pendiente', label: 'Pendiente' }, { val: 'completo', label: 'Completo' }, { val: 'no_aplica', label: 'No Aplica' }]}
                            />
                            <InputGroup label="Fecha Entrega" type="date" value={socio.documentacion?.consentimiento?.fechaEntrega} onChange={(v: string) => setSocio({ ...socio, documentacion: { ...socio.documentacion, consentimiento: { estado: 'pendiente', ...socio.documentacion?.consentimiento, fechaEntrega: v } } })} />
                        </div>

                        <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Declaración Jurada</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <SelectGroup
                                label="Estado"
                                value={socio.documentacion?.declaracionJurada?.estado || 'pendiente'}
                                onChange={(v: any) => setSocio({ ...socio, documentacion: { ...socio.documentacion, declaracionJurada: { fechaEntrega: '', ...socio.documentacion?.declaracionJurada, estado: v } } })}
                                options={[{ val: 'pendiente', label: 'Pendiente' }, { val: 'completo', label: 'Completo' }, { val: 'no_aplica', label: 'No Aplica' }]}
                            />
                            <InputGroup label="Fecha Entrega" type="date" value={socio.documentacion?.declaracionJurada?.fechaEntrega} onChange={(v: string) => setSocio({ ...socio, documentacion: { ...socio.documentacion, declaracionJurada: { estado: 'pendiente', ...socio.documentacion?.declaracionJurada, fechaEntrega: v } } })} />
                        </div>
                    </Section>

                    {/* SECCION H: Notas */}
                    <Section title="Notas Internas">
                        <InputGroup label="" value={socio.notas} onChange={(v: string) => setSocio({ ...socio, notas: v })} multiline />
                    </Section>

                </div>
            </div>
        </div>
    );
}
