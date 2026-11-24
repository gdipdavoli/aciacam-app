"use client";

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Socio, Producto, OrderType, OrderItem, Pedido } from '@/types';
import { ArrowLeft } from 'lucide-react';
import { SlotSelector } from '@/app/components/SlotSelector';
import PaymentRegistrationModal from '@/app/components/admin/PaymentRegistrationModal';

function toArgentinaDateKey(input: string): string {
    if (!input) return '';
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

function NewDispenseForm() {
    const { user, session, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const paramSocioId = searchParams.get('socioId');

    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Step 1: Socio
    const [socios, setSocios] = useState<Socio[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSocio, setSelectedSocio] = useState<Socio | null>(null);

    // Step 2: Order Details
    const today = toArgentinaDateKey(new Date().toISOString());
    const [orderType, setOrderType] = useState<OrderType>('retiro_sede');
    const [dispenseMode, setDispenseMode] = useState<'inmediata' | 'programada'>('inmediata');
    const [address, setAddress] = useState('');
    const [localidad, setLocalidad] = useState('');
    const [date, setDate] = useState(today);
    const [notes, setNotes] = useState('');

    // Slot Logic
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
    const [slotLabel, setSlotLabel] = useState('');
    const [slotDate, setSlotDate] = useState('');
    const [slotNotice, setSlotNotice] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<{
        address?: string;
        localidad?: string;
        date?: string;
        reprocannCheck?: string;
        reprocannEvidence?: string;
    }>({});

    // Step 3: Products & Idempotent Direct Dispensation State
    const [products, setProducts] = useState<Producto[]>([]);
    const [cart, setCart] = useState<Record<string, number>>({});
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [pendingOrder, setPendingOrder] = useState<Pedido | null>(null);
    const [cancellingPending, setCancellingPending] = useState(false);
    const [eligibility, setEligibility] = useState<any>(null);
    const [loadingEligibility, setLoadingEligibility] = useState(false);
    const [exceptionReq, setExceptionReq] = useState<'admision_institucional' | 'consentimiento' | 'declaracion_jurada' | 'contrato'>('consentimiento');
    const [exceptionJustif, setExceptionJustif] = useState('');
    const [exceptionEvidencia, setExceptionEvidencia] = useState('');
    const [savingException, setSavingException] = useState(false);
    const [reprocannAckChecked, setReprocannAckChecked] = useState(false);
    const [reprocannAckEvidence, setReprocannAckEvidence] = useState('');
    const [savingReprocannAck, setSavingReprocannAck] = useState(false);
    const [reprocannAckDone, setReprocannAckDone] = useState(false);
    const createIdempotencyKeyRef = useRef<string | null>(null);
    const createdOrderRef = useRef<Pedido | null>(null);

    const resetTransactionRefs = () => {
        createIdempotencyKeyRef.current = null;
        createdOrderRef.current = null;
        setPendingOrder(null);
    };

    const handleCancelPendingOrder = async () => {
        if (!pendingOrder || cancellingPending) return;
        setCancellingPending(true);
        setErrorMessage(null);
        try {
            await StoreService.updatePedidoStatus(pendingOrder.id, 'cancelado');
            resetTransactionRefs();
        } catch (err: any) {
            setErrorMessage(err?.message || 'No se pudo cancelar el pedido pendiente.');
        } finally {
            setCancellingPending(false);
        }
    };

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }
            StoreService.getAllSocios().then(allSocios => {
                setSocios(allSocios);
                if (paramSocioId) {
                    const match = allSocios.find(s => s.id === paramSocioId);
                    if (match) {
                        setSelectedSocio(match);
                        setAddress(match.direccion || '');
                        setLocalidad(match.localidad || '');
                        setStep(2);
                        void loadEligibility(match.id);
                    }
                }
            });
            StoreService.getProductos().then(setProducts);
        }
    }, [user, authLoading, router, paramSocioId]);

    const filteredSocios = socios.filter(s =>
        (s.nombre + ' ' + s.apellido).toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.dni.includes(searchTerm)
    );

    const loadEligibility = async (socioId: string) => {
        setLoadingEligibility(true);
        try {
            const evalRes = await StoreService.getSocioDispensationEligibility(socioId);
            setEligibility(evalRes);
            if (Array.isArray(evalRes?.excepcionesAdmisibles) && evalRes.excepcionesAdmisibles.length > 0) {
                setExceptionReq(evalRes.excepcionesAdmisibles[0]);
            }
        } catch (err: any) {
            setEligibility(null);
            setErrorMessage(err?.message || 'No se pudo verificar la elegibilidad documental del socio.');
        } finally {
            setLoadingEligibility(false);
        }
    };

    const handleSelectSocio = (s: Socio) => {
        resetTransactionRefs();
        setSelectedSocio(s);
        setAddress(s.direccion || '');
        setLocalidad(s.localidad || '');
        setReprocannAckChecked(false);
        setReprocannAckEvidence('');
        setReprocannAckDone(false);
        setErrorMessage(null);
        setStep(2);
        void loadEligibility(s.id);
    };

    const handleGrantException = async () => {
        if (!selectedSocio || savingException) return;
        if (exceptionJustif.trim().length < 10 || exceptionEvidencia.trim().length < 3) {
            setErrorMessage('Para autorizar una excepción se requiere justificación (mín. 10 caracteres) y referencia documental.');
            return;
        }
        setSavingException(true);
        setErrorMessage(null);
        try {
            await StoreService.grantDispensationException({
                commandId: crypto.randomUUID(),
                socioId: selectedSocio.id,
                requisitoPendiente: exceptionReq,
                justificacion: exceptionJustif.trim(),
                evidenciaReferencia: exceptionEvidencia.trim()
            });
            setExceptionJustif('');
            setExceptionEvidencia('');
            await loadEligibility(selectedSocio.id);
        } catch (err: any) {
            setErrorMessage(err?.message || 'No se pudo autorizar la excepción.');
        } finally {
            setSavingException(false);
        }
    };

    const needsReprocannVerificationAck = Boolean(
        eligibility?.puedeRegistrarPedido &&
        Array.isArray(eligibility?.advertenciasDocumentales) &&
        (eligibility.advertenciasDocumentales.includes('REPROCANN_NO_CARGADO') ||
            eligibility.advertenciasDocumentales.includes('REPROCANN_PENDIENTE_REVISION'))
    );

    const handleNextStep = async () => {
        const nextErrors: typeof fieldErrors = {};
        if (orderType === 'retiro_sede' && dispenseMode === 'programada' && !date) {
            nextErrors.date = 'Seleccioná una fecha de retiro o cambiá a Dispensa inmediata.';
        }
        if (orderType === 'delivery') {
            if (!address.trim()) nextErrors.address = 'Completá la dirección de entrega.';
            if (!localidad.trim()) nextErrors.localidad = 'Completá la localidad de entrega.';
        }
        if (needsReprocannVerificationAck && !reprocannAckDone) {
            if (!reprocannAckChecked) {
                nextErrors.reprocannCheck = 'Marcá la casilla de confirmación de verificación REPROCANN.';
            }
            if (reprocannAckEvidence.trim().length < 3) {
                nextErrors.reprocannEvidence = 'Ingresá una referencia válida de al menos 3 caracteres (ej.: MiArgentina, certificado físico o N° trámite).';
            }
        }
        setFieldErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            setErrorMessage(Object.values(nextErrors).join(' '));
            return;
        }
        if (needsReprocannVerificationAck && !reprocannAckDone) {
            if (!selectedSocio) return;
            setSavingReprocannAck(true);
            setErrorMessage(null);
            try {
                const estadoObs = eligibility.advertenciasDocumentales.includes('REPROCANN_PENDIENTE_REVISION')
                    ? 'pendiente_revision'
                    : 'no_cargado';
                await StoreService.registerReprocannExternalVerificationAck({
                    commandId: crypto.randomUUID(),
                    socioId: selectedSocio.id,
                    evidencia: reprocannAckEvidence.trim(),
                    estadoObservado: estadoObs
                });
                setReprocannAckDone(true);
            } catch (err: any) {
                setErrorMessage(err?.message || 'No se pudo registrar la confirmación de verificación REPROCANN.');
                setSavingReprocannAck(false);
                return;
            } finally {
                setSavingReprocannAck(false);
            }
        }
        setErrorMessage(null);
        setStep(3);
    }

    const handleAddToCart = (id: string, qty: number) => {
        if (pendingOrder) {
            setErrorMessage('Ya existe un pedido pendiente creado en esta sesión. Finalizalo o cancelalo antes de modificar los productos.');
            return;
        }
        resetTransactionRefs();
        setErrorMessage(null);
        setCart(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + qty) }));
    };

    const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);

    const buildOrderItems = (): OrderItem[] =>
        Object.entries(cart)
            .filter(([_, qty]) => qty > 0)
            .map(([id, qty]) => {
                const prod = products.find(p => p.id === id);
                return {
                    productoId: id,
                    cantidad: qty,
                    productoNombre: prod?.nombre || 'Desconocido'
                };
            });

    const handleOpenFinalizeModal = () => {
        if (!selectedSocio) return;
        if (orderType === 'delivery' && (!address.trim() || !localidad.trim())) {
            alert('Para modalidad delivery es obligatorio completar dirección y localidad.');
            return;
        }
        if (buildOrderItems().length === 0) {
            alert('El pedido debe tener al menos un producto.');
            return;
        }
        setErrorMessage(null);
        setShowPaymentModal(true);
    };

    const handleFinalizePayment = async (
        payments: Array<{ amount: number; method: string; reference?: string; concepto: string }>,
        isDonation: boolean,
        donationReason?: string,
        paymentCommandId?: string
    ) => {
        if (!selectedSocio || !user) {
            throw new Error('Falta seleccionar un socio o sesión administrativa válida.');
        }
        const items = buildOrderItems();
        if (items.length === 0) {
            throw new Error('El pedido debe tener al menos un producto.');
        }

        if (!createIdempotencyKeyRef.current) {
            createIdempotencyKeyRef.current = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now()}-0000-4000-8000-000000000000`;
        }

        try {
            if (!createdOrderRef.current) {
                createdOrderRef.current = await StoreService.createPedido(
                    selectedSocio.id,
                    items,
                    orderType,
                    {
                        origen: 'admin',
                        estado: 'pendiente',
                        idempotency_key: createIdempotencyKeyRef.current,
                        direccionEntrega: orderType === 'delivery' ? address.trim() : undefined,
                        localidad: orderType === 'delivery' ? localidad.trim() : undefined,
                        observaciones: notes.trim() || undefined,
                        fechaRetiroPreferida:
                            orderType === 'retiro_sede' && dispenseMode === 'programada'
                                ? (slotDate || date || undefined)
                                : undefined,
                        slotId:
                            orderType === 'retiro_sede' && dispenseMode === 'programada'
                                ? (selectedSlotId || undefined)
                                : undefined,
                        motivo_admin: notes.trim() || 'Dispensa directa administrativa en sede/delivery'
                    } as any
                );
                setPendingOrder(createdOrderRef.current);
            }

            if (needsReprocannVerificationAck && createdOrderRef.current?.id) {
                const estadoObs = eligibility?.advertenciasDocumentales?.includes('REPROCANN_PENDIENTE_REVISION')
                    ? 'pendiente_revision'
                    : 'no_cargado';
                await StoreService.registerReprocannExternalVerificationAck({
                    commandId: createIdempotencyKeyRef.current,
                    socioId: selectedSocio.id,
                    evidencia: reprocannAckEvidence.trim(),
                    estadoObservado: estadoObs,
                    pedidoId: createdOrderRef.current.id
                });
            }

            const targetStatus = orderType === 'delivery' ? 'entregado' : 'retirado';
            const actorId = session?.user?.id || user.auth_user_id || user.id;

            await StoreService.confirmOrderAndPayments(
                createdOrderRef.current.id,
                targetStatus,
                payments,
                isDonation,
                donationReason,
                actorId,
                paymentCommandId
            );

            resetTransactionRefs();
            setShowPaymentModal(false);
            alert('Dispensa registrada y finalizada correctamente');
            router.push('/admin');
        } catch (err: any) {
            const msg = err?.message || 'No se pudo completar la dispensa directa.';
            setErrorMessage(msg);
            throw new Error(msg);
        }
    };

    if (authLoading) return <div style={{ padding: '2rem' }}>Cargando...</div>;

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '3rem' }}>
            {/* Header */}
            <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button onClick={() => router.back()} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                    <ArrowLeft />
                </button>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nueva Dispensa Manual</h1>
            </div>

            {/* Stepper */}
            <div style={{ display: 'flex', marginBottom: '2rem', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '1rem' }}>
                {[1, 2, 3].map(s => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '2rem', opacity: step >= s ? 1 : 0.4 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: step >= s ? 'hsl(var(--primary))' : 'hsl(var(--muted))', color: step >= s ? 'white' : 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 600 }}>{s}</div>
                        <span style={{ fontWeight: 500 }}>{s === 1 ? 'Socio' : s === 2 ? 'Entrega' : 'Productos'}</span>
                    </div>
                ))}
            </div>

            {/* STEP 1: SELECT SOCIO */}
            {step === 1 && (
                <div>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Buscar Socio</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                placeholder="Nombre, DNI..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ width: '100%', padding: '0.75rem', paddingLeft: '2.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                                autoFocus
                            />
                            <SearchIcon style={{ position: 'absolute', left: 10, top: 12, opacity: 0.5 }} size={18} />
                        </div>
                    </div>

                    <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', maxHeight: '400px', overflowY: 'auto' }}>
                        {filteredSocios.map(s => {
                            const isDraft = s.status === 'draft';
                            const isSuspended = s.status === 'suspended';
                            const isBlocked = !!s.bloqueado;
                            const hasWarning = isDraft || isSuspended || isBlocked;

                            return (
                                <div
                                    key={s.id}
                                    onClick={() => handleSelectSocio(s)}
                                    style={{
                                        padding: '1rem',
                                        borderBottom: '1px solid hsl(var(--border))',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        backgroundColor: hasWarning ? 'rgba(254, 243, 199, 0.15)' : 'transparent'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <span>{s.apellido}, {s.nombre}</span>
                                            {isBlocked && (
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>
                                                    BLOQUEO PREVENTIVO
                                                </span>
                                            )}
                                            {isDraft && (
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                                                    ALTA PRELIMINAR (BORRADOR)
                                                </span>
                                            )}
                                            {isSuspended && (
                                                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>
                                                    SUSPENDIDO
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>DNI: {s.dni}</div>
                                    </div>
                                    <div style={{ color: hasWarning ? '#d97706' : 'hsl(var(--primary))', fontSize: '0.9rem', fontWeight: 500 }}>
                                        {hasWarning ? 'Atención →' : 'Seleccionar →'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* STEP 2: ORDER DETAILS */}
            {step === 2 && selectedSocio && (
                <div>
                    {loadingEligibility ? (
                        <div style={{ padding: '0.75rem 1rem', backgroundColor: 'hsl(var(--muted))', borderRadius: 'var(--radius)', marginBottom: '1rem', fontSize: '0.85rem' }}>
                            Verificando elegibilidad institucional y documental...
                        </div>
                    ) : eligibility && (
                        <div style={{
                            padding: '1rem',
                            borderRadius: 'var(--radius)',
                            marginBottom: '1rem',
                            border: !eligibility.puedeFinalizarDispensa
                                ? '1px solid #fca5a5'
                                : eligibility.requiereRegularizacion
                                    ? '1px solid #fcd34d'
                                    : '1px solid #86efac',
                            backgroundColor: !eligibility.puedeFinalizarDispensa
                                ? '#fef2f2'
                                : eligibility.requiereRegularizacion
                                    ? '#fffbeb'
                                    : '#f0fdf4',
                            fontSize: '0.85rem'
                        }}>
                            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                                Solicitar: {eligibility.puedeSolicitar ? 'Sí' : 'No'}
                                {' '}| Registrar pedido: {eligibility.puedeRegistrarPedido ? 'Sí' : 'No'}
                                {' '}| Finalizar dispensa: {eligibility.puedeFinalizarDispensa ? 'Sí' : 'Bloqueada'}
                                {' '}| Acceso digital: {eligibility.accesoDigitalEstado}
                            </div>
                            {Array.isArray(eligibility.bloqueosObligatorios) && eligibility.bloqueosObligatorios.length > 0 && (
                                <div style={{ color: '#991b1b', marginBottom: '0.35rem' }}>
                                    <strong>Impedimentos obligatorios:</strong> {eligibility.bloqueosObligatorios.join(', ')}
                                </div>
                            )}
                            {Array.isArray(eligibility.advertenciasDocumentales) && eligibility.advertenciasDocumentales.length > 0 && (
                                <div style={{ color: '#92400e', marginBottom: '0.35rem' }}>
                                    <strong>Advertencias documentales (regularización pendiente, no bloquean registro):</strong> {eligibility.advertenciasDocumentales.join(', ')}
                                </div>
                            )}
                            {needsReprocannVerificationAck && (
                                <div style={{ marginTop: '0.65rem', padding: '0.75rem', borderRadius: 'var(--radius)', backgroundColor: '#fef3c7', border: '1px solid #f59e0b', color: '#78350f' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                                        ⚠️ REPROCANN sin respaldo digital aprobado (no digitalizado o pendiente de revisión)
                                    </div>
                                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem' }}>
                                        Esta confirmación registra responsable, fecha y evidencia de verificación por otra fuente. <strong>No sustituye</strong> el certificado REPROCANN digitalizado ni lo marca como aprobado.
                                    </p>
                                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={reprocannAckChecked}
                                            disabled={reprocannAckDone}
                                            onChange={e => {
                                                setReprocannAckChecked(e.target.checked);
                                                setFieldErrors(prev => ({ ...prev, reprocannCheck: undefined }));
                                                setErrorMessage(null);
                                            }}
                                            style={{ marginTop: '0.2rem' }}
                                        />
                                        <span>Confirmo que verifiqué la autorización REPROCANN vigente del socio por otra fuente.</span>
                                    </label>
                                    {fieldErrors.reprocannCheck && (
                                        <p style={{ margin: '0 0 0.4rem 0', fontSize: '0.78rem', color: '#991b1b', fontWeight: 600 }}>
                                            {fieldErrors.reprocannCheck}
                                        </p>
                                    )}
                                    <input
                                        type="text"
                                        value={reprocannAckEvidence}
                                        disabled={reprocannAckDone}
                                        onChange={e => {
                                            setReprocannAckEvidence(e.target.value);
                                            setFieldErrors(prev => ({ ...prev, reprocannEvidence: undefined }));
                                            setErrorMessage(null);
                                        }}
                                        placeholder="Fuente / evidencia verificada (ej. MiArgentina, certificado físico en sede, n° trámite) *"
                                        style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: 'var(--radius)', border: fieldErrors.reprocannEvidence ? '2px solid #dc2626' : '1px solid #d97706', backgroundColor: 'white', color: '#111827', fontSize: '0.8rem' }}
                                    />
                                    {fieldErrors.reprocannEvidence ? (
                                        <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#991b1b', fontWeight: 600 }}>
                                            {fieldErrors.reprocannEvidence}
                                        </p>
                                    ) : reprocannAckEvidence.trim().length > 0 && reprocannAckEvidence.trim().length < 3 ? (
                                        <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.75rem', color: '#92400e' }}>
                                            Faltan {3 - reprocannAckEvidence.trim().length} caracteres (mínimo 3 caracteres descriptivos).
                                        </p>
                                    ) : null}
                                    {reprocannAckDone && (
                                        <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', fontWeight: 600, color: '#166534' }}>
                                            ✓ Verificación operativa registrada en auditoría.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <div style={{ padding: '1rem', backgroundColor: 'hsl(var(--muted))', borderRadius: 'var(--radius)', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <strong>Socio:</strong> {selectedSocio.nombre} {selectedSocio.apellido} (DNI {selectedSocio.dni})
                        </div>
                        <button onClick={() => setStep(1)} style={{ fontSize: '0.8rem', color: 'blue', border: 'none', background: 'none', cursor: 'pointer' }}>Cambiar</button>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Tipo de Entrega</label>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => { resetTransactionRefs(); setOrderType('retiro_sede'); }}
                                style={{
                                    flex: 1, padding: '1rem', borderRadius: 'var(--radius)', border: orderType === 'retiro_sede' ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                                    backgroundColor: orderType === 'retiro_sede' ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                                    cursor: 'pointer'
                                }}
                            >
                                🏢 Retiro en Sede
                            </button>
                            <button
                                onClick={() => { resetTransactionRefs(); setOrderType('delivery'); }}
                                style={{
                                    flex: 1, padding: '1rem', borderRadius: 'var(--radius)', border: orderType === 'delivery' ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                                    backgroundColor: orderType === 'delivery' ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                                    cursor: 'pointer'
                                }}
                            >
                                🛵 Delivery
                            </button>
                        </div>
                    </div>

                    {orderType === 'retiro_sede' ? (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Modalidad de Retiro en Sede</label>
                            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDispenseMode('inmediata');
                                        setSelectedSlotId(null);
                                        setSlotLabel('');
                                        setSlotDate('');
                                        setSlotNotice(null);
                                        setFieldErrors(prev => ({ ...prev, date: undefined }));
                                    }}
                                    style={{
                                        flex: 1,
                                        minWidth: '200px',
                                        padding: '0.75rem 1rem',
                                        borderRadius: 'var(--radius)',
                                        border: dispenseMode === 'inmediata' ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                                        backgroundColor: dispenseMode === 'inmediata' ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                                        fontWeight: dispenseMode === 'inmediata' ? 600 : 500,
                                        cursor: 'pointer',
                                        textAlign: 'left'
                                    }}
                                >
                                    ⚡ Dispensa inmediata (sin turno)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDispenseMode('programada')}
                                    style={{
                                        flex: 1,
                                        minWidth: '200px',
                                        padding: '0.75rem 1rem',
                                        borderRadius: 'var(--radius)',
                                        border: dispenseMode === 'programada' ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                                        backgroundColor: dispenseMode === 'programada' ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                                        fontWeight: dispenseMode === 'programada' ? 600 : 500,
                                        cursor: 'pointer',
                                        textAlign: 'left'
                                    }}
                                >
                                    📅 Entrega programada (fecha / turno)
                                </button>
                            </div>

                            {dispenseMode === 'inmediata' ? (
                                <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--border))', fontSize: '0.85rem' }}>
                                    Sin turno obligatorio. La fecha y hora efectiva de dispensa se registrarán automáticamente en el servidor al confirmar la entrega.
                                </div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                        <div style={{ flex: 1, minWidth: '220px' }}>
                                            <label style={{ fontSize: '0.8rem', opacity: 0.85, display: 'block', marginBottom: '0.25rem' }}>
                                                Fecha programada de retiro
                                            </label>
                                            <input
                                                type="date"
                                                value={date}
                                                onChange={e => {
                                                    const newDate = e.target.value;
                                                    setDate(newDate);
                                                    setFieldErrors(prev => ({ ...prev, date: undefined }));
                                                    if (selectedSlotId && slotDate && slotDate !== newDate) {
                                                        setSelectedSlotId(null);
                                                        setSlotLabel('');
                                                        setSlotDate('');
                                                        setSlotNotice('Se quitó el turno seleccionado porque correspondía a otra fecha.');
                                                    } else {
                                                        setSlotNotice(null);
                                                    }
                                                }}
                                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: fieldErrors.date ? '2px solid #dc2626' : '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                                            />
                                            {fieldErrors.date && (
                                                <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.78rem', color: '#dc2626', fontWeight: 600 }}>
                                                    {fieldErrors.date}
                                                </p>
                                            )}
                                        </div>
                                        {selectedSlotId && slotLabel && (
                                            <div style={{ flex: 1, minWidth: '220px', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius)', border: '1px solid #86efac', backgroundColor: '#f0fdf4', fontSize: '0.8rem', color: '#166534' }}>
                                                <strong>Turno seleccionado:</strong> {slotLabel} ({slotDate})
                                            </div>
                                        )}
                                    </div>
                                    {slotNotice && (
                                        <p style={{ fontSize: '0.8rem', color: '#92400e', marginBottom: '0.5rem' }}>{slotNotice}</p>
                                    )}
                                    <p style={{ fontSize: '0.8rem', marginBottom: '0.5rem', opacity: 0.8 }}>Opcional: seleccioná un turno disponible (la fecha se sincroniza automáticamente):</p>
                                    <SlotSelector
                                        selectedSlotId={selectedSlotId}
                                        onSelect={(id, label, startTimeIso) => {
                                            const dateKey = toArgentinaDateKey(startTimeIso);
                                            setSelectedSlotId(id);
                                            setSlotLabel(label);
                                            setSlotDate(dateKey);
                                            if (dateKey) setDate(dateKey);
                                            setSlotNotice(null);
                                            setFieldErrors(prev => ({ ...prev, date: undefined }));
                                        }}
                                    />
                                </>
                            )}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Dirección de Entrega *</label>
                                <input
                                    type="text"
                                    value={address}
                                    onChange={e => {
                                        resetTransactionRefs();
                                        setAddress(e.target.value);
                                        setFieldErrors(prev => ({ ...prev, address: undefined }));
                                        setErrorMessage(null);
                                    }}
                                    placeholder="Ej: Av. Rivadavia 1234"
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: fieldErrors.address ? '2px solid #dc2626' : '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                                />
                                {fieldErrors.address && (
                                    <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.78rem', color: '#dc2626', fontWeight: 600 }}>
                                        {fieldErrors.address}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Localidad *</label>
                                <input
                                    type="text"
                                    value={localidad}
                                    onChange={e => {
                                        resetTransactionRefs();
                                        setLocalidad(e.target.value);
                                        setFieldErrors(prev => ({ ...prev, localidad: undefined }));
                                        setErrorMessage(null);
                                    }}
                                    placeholder="Ej: CABA / La Plata / Quilmes"
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: fieldErrors.localidad ? '2px solid #dc2626' : '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                                />
                                {fieldErrors.localidad && (
                                    <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.78rem', color: '#dc2626', fontWeight: 600 }}>
                                        {fieldErrors.localidad}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Observaciones / Notas</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', minHeight: '80px', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }} placeholder="Opcional..." />
                    </div>

                    {errorMessage && (
                        <div role="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.88rem', fontWeight: 500 }}>
                            {errorMessage}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={handleNextStep}
                        disabled={
                            savingReprocannAck ||
                            Boolean(eligibility && !eligibility.puedeRegistrarPedido)
                        }
                        style={{
                            width: '100%',
                            padding: '1rem',
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'white',
                            border: 'none',
                            borderRadius: 'var(--radius)',
                            fontSize: '1rem',
                            fontWeight: 600,
                            cursor: (savingReprocannAck || (eligibility && !eligibility.puedeRegistrarPedido)) ? 'not-allowed' : 'pointer',
                            opacity: (savingReprocannAck || (eligibility && !eligibility.puedeRegistrarPedido)) ? 0.5 : 1
                        }}
                    >
                        {savingReprocannAck
                            ? 'Registrando verificación...'
                            : eligibility && !eligibility.puedeRegistrarPedido
                                ? 'Socio bloqueado o suspendido'
                                : 'Continuar'}
                    </button>
                </div>
            )}

            {/* STEP 3: PRODUCTS */}
            {step === 3 && (
                <div>
                    <h3 style={{ marginBottom: '1rem' }}>Seleccionar Productos</h3>
                    <div style={{ marginBottom: '2rem' }}>
                        {products.map(p => {
                            const qty = cart[p.id] || 0;
                            return (
                                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid hsl(var(--border))' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>{p.tipo} - {p.categoria}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {qty > 0 && (
                                            <button onClick={() => handleAddToCart(p.id, -1)} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid hsl(var(--border))', cursor: 'pointer' }}>-</button>
                                        )}
                                        <span style={{ width: 30, textAlign: 'center', fontWeight: 600 }}>{qty}</span>
                                        <button onClick={() => handleAddToCart(p.id, 1)} style={{ width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none' }}>+</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ padding: '1.5rem', backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                        <h4 style={{ marginBottom: '1rem' }}>Resumen del Pedido</h4>
                        {totalItems === 0 ? (
                            <p style={{ color: 'hsl(var(--muted-foreground))' }}>Selecciona productos para continuar.</p>
                        ) : (
                            <ul style={{ marginBottom: '1.5rem', paddingLeft: '1rem' }}>
                                {Object.entries(cart).filter(([_, q]) => q > 0).map(([id, q]) => {
                                    const p = products.find(x => x.id === id);
                                    return <li key={id}>{p?.nombre} x {q}</li>
                                })}
                            </ul>
                        )}

                        {pendingOrder && (
                            <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                <span>
                                    Pedido pendiente <strong>#{pendingOrder.id.slice(0, 8)}</strong> ya creado (stock reservado). Podés reintentar la finalización sin duplicar o cancelarlo para editar.
                                </span>
                                <button
                                    type="button"
                                    onClick={handleCancelPendingOrder}
                                    disabled={cancellingPending}
                                    style={{ padding: '0.4rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid #d97706', backgroundColor: 'white', color: '#92400e', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    {cancellingPending ? 'Cancelando...' : 'Cancelar pedido pendiente'}
                                </button>
                            </div>
                        )}

                        {errorMessage && (
                            <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.9rem' }}>
                                {errorMessage}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => setStep(2)}
                                disabled={Boolean(pendingOrder)}
                                style={{ flex: 1, padding: '1rem', backgroundColor: 'transparent', color: 'inherit', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', fontSize: '1rem', fontWeight: 600, cursor: pendingOrder ? 'not-allowed' : 'pointer', opacity: pendingOrder ? 0.5 : 1 }}
                            >
                                Volver
                            </button>
                            <button
                                onClick={handleOpenFinalizeModal}
                                disabled={totalItems === 0}
                                style={{ flex: 2, padding: '1rem', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', borderRadius: 'var(--radius)', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', opacity: totalItems === 0 ? 0.5 : 1 }}
                            >
                                {pendingOrder ? 'Reintentar Finalización' : 'Registrar y Finalizar Dispensa'}
                            </button>
                        </div>
                    </div>

                    <PaymentRegistrationModal
                        isOpen={showPaymentModal}
                        onClose={() => setShowPaymentModal(false)}
                        onConfirm={handleFinalizePayment}
                        orderItems={buildOrderItems()}
                        socioName={`${selectedSocio?.apellido || ''}, ${selectedSocio?.nombre || ''}`.trim()}
                        orderSummary={{
                            estado: 'confirmado',
                            tipoPedido: orderType,
                            fechaRetiroPreferida: orderType === 'retiro_sede' ? (slotDate || date) : undefined,
                            franjaHoraria: slotLabel || undefined,
                            direccionEntrega: orderType === 'delivery' ? address : undefined,
                            localidad: orderType === 'delivery' ? localidad : undefined
                        }}
                    />
                </div>
            )}
        </div>
    );
}

export default function NewDispensePage() {
    return (
        <Suspense fallback={<div style={{ padding: '2rem' }}>Cargando...</div>}>
            <NewDispenseForm />
        </Suspense>
    );
}

const SearchIcon = ({ size, style }: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);
