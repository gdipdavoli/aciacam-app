import React, { useState, useEffect, useRef } from 'react';
import { StoreService } from '@/services/storeService';
import { OrderItem, OrderStatus, OrderType, Producto, PagoConcepto } from '@/types';
import { isOilProduct, resolveOrderTotal } from '@/app/lib/order-pricing';
import { X, Plus, Trash2, ShieldAlert, Loader2, Landmark, CreditCard, Coins, Gift } from 'lucide-react';

interface PaymentLine {
    id: string;
    amount: number;
    method: 'transferencia_galicia' | 'mercadopago' | 'efectivo' | string;
    reference: string;
    concepto: PagoConcepto;
}

interface PaymentRegistrationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (
        payments: Array<{ amount: number, method: string, reference?: string, concepto: string }>,
        isDonation: boolean,
        donationReason?: string,
        commandId?: string
    ) => Promise<void>;
    orderItems: OrderItem[];
    socioName: string;
    orderSummary?: {
        estado?: OrderStatus;
        tipoPedido?: OrderType;
        fechaRetiroPreferida?: string;
        franjaHoraria?: string;
        entrega_estimada?: string;
        direccionEntrega?: string;
        localidad?: string;
        total?: number;
    };
}

const parsePaymentAmount = (rawValue: string): number => {
    const value = rawValue.trim().replace(/[^\d,.-]/g, '');
    if (!value) return 0;

    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');
    const lastSeparator = Math.max(lastComma, lastDot);
    const separator = lastSeparator === -1 ? '' : value[lastSeparator];
    const digitsAfterSeparator = lastSeparator === -1 ? 0 : value.length - lastSeparator - 1;
    const decimalSeparator = digitsAfterSeparator > 0 && digitsAfterSeparator <= 2 ? separator : '';

    const normalized = decimalSeparator === ','
        ? value.replace(/\./g, '').replace(',', '.')
        : decimalSeparator === '.'
            ? value.replace(/,/g, '')
            : value.replace(/[.,]/g, '');

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export default function PaymentRegistrationModal({
    isOpen,
    onClose,
    onConfirm,
    orderItems,
    socioName,
    orderSummary
}: PaymentRegistrationModalProps) {
    const [products, setProducts] = useState<Producto[]>([]);
    const [aportePorGramo, setAportePorGramo] = useState<number>(10000);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const attemptCommandIdsRef = useRef<Map<string, string>>(new Map());
    
    // Limits
    const [exceedsFlowers, setExceedsFlowers] = useState(false);
    const [exceedsGoteros, setExceedsGoteros] = useState(false);
    const [totalFlowersGrams, setTotalFlowersGrams] = useState(0);
    const [totalGoterosUnits, setTotalGoterosUnits] = useState(0);

    // Payments Form
    const [paymentMode, setPaymentMode] = useState<'aporte' | 'pendiente' | 'bonificado'>('aporte');
    const [bonificadoReason, setBonificadoReason] = useState('');
    const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
        {
            id: '1',
            amount: 0,
            method: 'transferencia_galicia',
            reference: '',
            concepto: 'aporte_sostenimiento'
        }
    ]);

    useEffect(() => {
        if (isOpen) {
            setLoadingProducts(true);
            Promise.all([
                StoreService.getProductos(true),
                StoreService.getGlobalConfigs().catch(() => ({ aporte_por_gramo: 10000 }))
            ])
                .then(([prods, cfg]) => {
                    setProducts(prods);
                    if (cfg && typeof (cfg as any).aporte_por_gramo === 'number') {
                        setAportePorGramo((cfg as any).aporte_por_gramo);
                    }
                })
                .catch(err => console.error("Error loading products:", err))
                .finally(() => setLoadingProducts(false));
        } else {
            attemptCommandIdsRef.current.clear();
            setPaymentMode('aporte');
            setBonificadoReason('');
        }
    }, [isOpen]);

    useEffect(() => {
        if (products.length > 0 && orderItems.length > 0) {
            let flowers = 0;
            let goteros = 0;

            orderItems.forEach(item => {
                const prod = products.find(p => p.id === item.productoId);
                if (prod) {
                    if (isOilProduct(prod.tipo)) {
                        goteros += item.cantidad;
                    } else if (prod.tipo === 'flor') {
                        flowers += item.cantidad * (prod.peso_gramos || 1);
                    }
                }
            });

            setTotalFlowersGrams(flowers);
            setTotalGoterosUnits(goteros);
            setExceedsFlowers(flowers > 40);
            setExceedsGoteros(goteros > 6);
        }
    }, [products, orderItems]);

    if (!isOpen) return null;

    const addPaymentLine = () => {
        setPaymentLines(prev => [
            ...prev,
            {
                id: Date.now().toString(),
                amount: 0,
                method: 'transferencia_galicia',
                reference: '',
                concepto: 'aporte_sostenimiento'
            }
        ]);
    };

    const removePaymentLine = (id: string) => {
        if (paymentLines.length === 1) return;
        setPaymentLines(prev => prev.filter(line => line.id !== id));
    };

    const updateLine = (id: string, field: keyof PaymentLine, value: any) => {
        setPaymentLines(prev =>
            prev.map(line => (line.id === id ? { ...line, [field]: value } : line))
        );
    };

    const getStableCommandId = (signature: string): string => {
        const existing = attemptCommandIdsRef.current.get(signature);
        if (existing) return existing;
        const nextId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-0000-4000-8000-000000000000`;
        attemptCommandIdsRef.current.set(signature, nextId);
        return nextId;
    };

    const handleConfirm = async () => {
        if (submitting || exceedsFlowers || exceedsGoteros) return; // Prevent double-click & invalid limits
        
        setSubmitting(true);
        try {
            if (paymentMode === 'bonificado') {
                if (!bonificadoReason.trim()) {
                    alert("Por favor, ingresá el motivo del aporte bonificado.");
                    setSubmitting(false);
                    return;
                }
                const signature = JSON.stringify({ paymentMode: 'bonificado', bonificadoReason: bonificadoReason.trim() });
                const commandId = getStableCommandId(signature);
                // Donación / Bonificación expresamente autorizada
                await onConfirm([], true, bonificadoReason.trim(), commandId);
            } else if (paymentMode === 'pendiente') {
                const signature = JSON.stringify({ paymentMode: 'pendiente' });
                const commandId = getStableCommandId(signature);
                // Entrega sin aporte inicial: p_payments = [], sin bonificación ni cancelación automática
                await onConfirm([], false, undefined, commandId);
            } else {
                // Regular payment lines (completo o parcial)
                const validLines = paymentLines.filter(l => l.amount > 0);
                if (validLines.length === 0) {
                    alert("Por favor, cargá al menos un medio de pago con un monto mayor a cero.");
                    setSubmitting(false);
                    return;
                }
                const formatted = validLines.map(l => ({
                    amount: l.amount,
                    method: l.method,
                    reference: l.reference ? l.reference.trim() : undefined,
                    concepto: l.concepto
                }));
                const signature = JSON.stringify({ paymentMode: 'aporte', formatted });
                const commandId = getStableCommandId(signature);
                await onConfirm(formatted, false, undefined, commandId);
            }
            attemptCommandIdsRef.current.clear();
            onClose();
        } catch (error: any) {
            console.error("Error in PaymentRegistrationModal confirm:", error);
            alert(error.message || "Hubo un error al confirmar la entrega.");
        } finally {
            setSubmitting(false);
        }
    };

    const totalAporte = paymentLines.reduce((acc, l) => acc + (l.amount || 0), 0);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-card w-full max-w-xl rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="bg-muted/40 p-5 border-b border-border flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-black text-foreground">Registrar Entrega y Aportes</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Socio: <strong className="text-primary font-bold">{socioName}</strong></p>
                    </div>
                    <button onClick={onClose} disabled={submitting} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    
                    {/* Legal limits check */}
                    {loadingProducts ? (
                        <div className="text-center py-4 text-xs text-muted-foreground">Validando límites legales de transporte...</div>
                    ) : (
                        (exceedsFlowers || exceedsGoteros) && (
                            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-4 rounded-xl flex gap-3 text-red-800 dark:text-red-300">
                                <ShieldAlert className="shrink-0 text-red-600 dark:text-red-400" size={24} />
                                <div className="space-y-1">
                                    <h4 className="text-xs font-black uppercase tracking-wider">Límite Legal de Transporte Excedido</h4>
                                    <p className="text-xs leading-relaxed">
                                        De acuerdo a la Res. 800/2021, el porte individual no puede superar los **40 g de flores secas** o **6 goteros de 30 ml** por remito.
                                    </p>
                                    <div className="text-xs mt-1.5 bg-red-100/50 dark:bg-red-950/50 p-2 rounded-lg font-medium space-y-0.5">
                                        {exceedsFlowers && <div> Flores en pedido: <span className="font-bold">{totalFlowersGrams} g</span> (Límite: 40 g)</div>}
                                        {exceedsGoteros && <div> Goteros en pedido: <span className="font-bold">{totalGoterosUnits} u</span> (Límite: 6 u)</div>}
                                    </div>
                                    <p className="text-[11px] mt-2 italic font-semibold">
                                        Acción Requerida: Por favor, cancelá la confirmación y utilizá las funciones de edición/duplicación para dividir esta entrega en remitos/pedidos independientes.
                                    </p>
                                </div>
                            </div>
                        )
                    )}

                    {/* Order summary box */}
                    {(() => {
                        const productsById = new Map(products.map(p => [p.id, p]));
                        const expectedAporte = resolveOrderTotal(
                            { total: orderSummary?.total, items: orderItems },
                            productsById,
                            aportePorGramo
                        );
                        return (
                            <div className="bg-muted/30 p-4 rounded-xl border border-border/80 space-y-3">
                                {orderSummary && (
                                    <div className="grid grid-cols-2 gap-2 pb-2.5 border-b border-border/60 text-xs">
                                        <div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Modalidad</span>
                                            <span className="font-semibold text-foreground">
                                                {orderSummary.tipoPedido === 'retiro_sede' ? 'Retiro en Sede' : 'Delivery'}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Fecha y Horario</span>
                                            <span className="font-semibold text-foreground">
                                                {orderSummary.tipoPedido === 'retiro_sede'
                                                    ? `${orderSummary.fechaRetiroPreferida || 'A coordinar'}${orderSummary.franjaHoraria ? ` · ${orderSummary.franjaHoraria}` : ''}`
                                                    : (orderSummary.entrega_estimada || orderSummary.localidad || 'A coordinar')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                                {(orderSummary?.estado === 'pendiente' || orderSummary?.estado === 'en_preparacion') && (
                                    <div className="text-[11px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-200 px-3 py-2 rounded-lg font-medium">
                                        Entrega directa desde estado <strong>{orderSummary.estado === 'pendiente' ? 'Pendiente' : 'En preparación'}</strong>: al confirmar se aprobará y finalizará el pedido de forma atómica.
                                    </div>
                                )}
                                <div>
                                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-wider block mb-2">Detalle de Dispensas del Pedido</span>
                                    <div className="text-xs font-semibold text-foreground space-y-1.5">
                                        {orderItems.map((item, idx) => (
                                            <div key={idx} className="flex justify-between">
                                                <span>{item.productoNombre || (item as any).nombre || (item.productoId ? `Producto no identificado (${item.productoId.slice(0, 8)})` : 'Producto no identificado')}</span>
                                                <span className="text-muted-foreground">x{item.cantidad}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-2.5 border-t border-border/60 text-xs">
                                    <span className="font-bold text-muted-foreground uppercase tracking-wider">Aporte correspondiente</span>
                                    <span className="text-sm font-black text-primary">
                                        {expectedAporte > 0 ? `$${expectedAporte.toLocaleString('es-AR')}` : 'A definir'}
                                    </span>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Payment/Pending/Bonification Option Select */}
                    {!(exceedsFlowers || exceedsGoteros) && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-2">
                                <label className={`flex items-start gap-2.5 cursor-pointer p-3 rounded-xl border transition-colors ${paymentMode === 'aporte' ? 'bg-primary/5 border-primary/40' : 'bg-muted/20 hover:bg-muted/40'}`}>
                                    <input
                                        type="radio"
                                        name="paymentResolutionMode"
                                        className="mt-0.5 w-4 h-4 text-primary focus:ring-primary"
                                        checked={paymentMode === 'aporte'}
                                        onChange={() => setPaymentMode('aporte')}
                                    />
                                    <div className="text-xs">
                                        <strong className="text-foreground font-black block">Registrar aporte ahora (completo o parcial)</strong>
                                        <span className="text-muted-foreground block text-[11px] mt-0.5">Carga uno o más medios de pago recibidos en el acto de entrega.</span>
                                    </div>
                                </label>

                                <label className={`flex items-start gap-2.5 cursor-pointer p-3 rounded-xl border transition-colors ${paymentMode === 'pendiente' ? 'bg-amber-500/10 border-amber-500/40' : 'bg-muted/20 hover:bg-muted/40'}`}>
                                    <input
                                        type="radio"
                                        name="paymentResolutionMode"
                                        className="mt-0.5 w-4 h-4 text-amber-600 focus:ring-amber-600"
                                        checked={paymentMode === 'pendiente'}
                                        onChange={() => setPaymentMode('pendiente')}
                                    />
                                    <div className="text-xs">
                                        <strong className="text-foreground font-black block">Entregar sin aporte inicial (Pendiente de cobro posterior)</strong>
                                        <span className="text-muted-foreground block text-[11px] mt-0.5">Confirma la entrega sin registrar pagos ni bonificación; el aporte queda pendiente para registro posterior.</span>
                                    </div>
                                </label>

                                <label className={`flex items-start gap-2.5 cursor-pointer p-3 rounded-xl border transition-colors ${paymentMode === 'bonificado' ? 'bg-primary/5 border-primary/40' : 'bg-muted/20 hover:bg-muted/40'}`}>
                                    <input
                                        type="radio"
                                        name="paymentResolutionMode"
                                        className="mt-0.5 w-4 h-4 text-primary focus:ring-primary"
                                        checked={paymentMode === 'bonificado'}
                                        onChange={() => setPaymentMode('bonificado')}
                                    />
                                    <div className="text-xs">
                                        <strong className="text-foreground font-black block">Aporte institucional bonificado (Sin cargo)</strong>
                                        <span className="text-muted-foreground block text-[11px] mt-0.5">Marcar únicamente si esta entrega cuenta con autorización expresa de bonificación por razones extraordinarias.</span>
                                    </div>
                                </label>
                            </div>

                            {paymentMode === 'bonificado' ? (
                                /* Bonificación Reason */
                                <div className="space-y-1.5 animate-in fade-in duration-200">
                                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block flex items-center gap-1.5">
                                        <Gift size={14} className="text-primary" />
                                        Motivo del aporte bonificado (Requerido)
                                    </label>
                                    <textarea
                                        placeholder="Ej: Paciente bajo tratamiento médico prioritario autorizado por Comisión Directiva."
                                        required
                                        value={bonificadoReason}
                                        onChange={e => setBonificadoReason(e.target.value)}
                                        rows={3}
                                        className="w-full p-3 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                    />
                                </div>
                            ) : paymentMode === 'pendiente' ? (
                                /* Entrega sin aporte inicial */
                                <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-200 space-y-1 animate-in fade-in duration-200">
                                    <strong className="font-black block">Entrega sin aporte inicial</strong>
                                    <p>No se creará ningún registro de pago ni se marcará bonificación. El saldo no se considera cancelado y el aporte deberá registrarse posteriormente.</p>
                                </div>
                            ) : (
                                /* Regular Payment lines */
                                <div className="space-y-4 animate-in fade-in duration-200">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-black text-muted-foreground uppercase tracking-wider block">Desglose de Aportes</span>
                                        <button
                                            type="button"
                                            onClick={addPaymentLine}
                                            className="text-xs font-bold text-primary hover:text-primary/95 flex items-center gap-1"
                                        >
                                            <Plus size={14} />
                                            Añadir medio de pago
                                        </button>
                                    </div>

                                    <div className="space-y-3">
                                        {paymentLines.map((line, idx) => (
                                            <div key={line.id} className="p-4 bg-muted/20 border rounded-xl flex flex-col md:flex-row gap-3 items-start md:items-center relative">
                                                {paymentLines.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removePaymentLine(line.id)}
                                                        className="absolute top-2 right-2 md:relative md:top-0 md:right-0 p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}

                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full flex-1">
                                                    {/* Concept */}
                                                    <div className="col-span-2 md:col-span-1">
                                                        <label className="text-[10px] font-bold text-muted-foreground block mb-1">Concepto</label>
                                                        <select
                                                            value={line.concepto}
                                                            onChange={e => updateLine(line.id, 'concepto', e.target.value)}
                                                            className="w-full p-2 text-xs border rounded-lg bg-background text-foreground"
                                                        >
                                                            <option value="aporte_sostenimiento">Aporte Cultivo</option>
                                                            <option value="cuota_social">Cuota Social</option>
                                                            <option value="donacion">Donación Extra</option>
                                                            <option value="otro">Otro</option>
                                                        </select>
                                                    </div>

                                                    {/* Method */}
                                                    <div className="col-span-2 md:col-span-1">
                                                        <label className="text-[10px] font-bold text-muted-foreground block mb-1">Medio de Pago</label>
                                                        <select
                                                            value={line.method}
                                                            onChange={e => updateLine(line.id, 'method', e.target.value)}
                                                            className="w-full p-2 text-xs border rounded-lg bg-background text-foreground"
                                                        >
                                                            <option value="transferencia_galicia">Galicia (Transf.)</option>
                                                            <option value="mercadopago">MercadoPago</option>
                                                            <option value="efectivo">Efectivo</option>
                                                        </select>
                                                    </div>

                                                    {/* Amount */}
                                                    <div>
                                                        <label className="text-[10px] font-bold text-muted-foreground block mb-1">Monto ($)</label>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            min="1"
                                                            placeholder="0"
                                                            value={line.amount || ''}
                                                            onChange={e => updateLine(line.id, 'amount', parsePaymentAmount(e.target.value))}
                                                            className="w-full p-2 text-xs border rounded-lg bg-background text-foreground"
                                                        />
                                                    </div>

                                                    {/* Reference */}
                                                    <div>
                                                        <label className="text-[10px] font-bold text-muted-foreground block mb-1">Referencia / Comprobante</label>
                                                        <input
                                                            type="text"
                                                            placeholder="Ej: Galicia 124"
                                                            value={line.reference}
                                                            onChange={e => updateLine(line.id, 'reference', e.target.value)}
                                                            className="w-full p-2 text-xs border rounded-lg bg-background text-foreground"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    {/* Total Box */}
                                    <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 flex justify-between items-center text-sm font-bold text-primary">
                                        <span>Total Aportes a Registrar:</span>
                                        <span className="text-base font-black">${totalAporte.toLocaleString('es-AR')}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div className="bg-muted/40 p-4 border-t border-border flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 bg-transparent hover:bg-muted text-muted-foreground rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={submitting || exceedsFlowers || exceedsGoteros}
                        className="px-5 py-2 text-white bg-primary hover:bg-primary/95 rounded-xl text-sm font-black transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={!(submitting || exceedsFlowers || exceedsGoteros) ? { backgroundColor: '#0F3822' } : {}}
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="animate-spin" size={16} />
                                Procesando...
                            </>
                        ) : (
                            'Confirmar Entrega'
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
}
