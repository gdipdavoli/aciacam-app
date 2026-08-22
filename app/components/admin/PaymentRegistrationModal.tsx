import React, { useState, useEffect } from 'react';
import { StoreService } from '@/services/storeService';
import { OrderItem, Producto, PagoConcepto } from '@/types';
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
        donationReason?: string
    ) => Promise<void>;
    orderItems: OrderItem[];
    socioName: string;
}

export default function PaymentRegistrationModal({
    isOpen,
    onClose,
    onConfirm,
    orderItems,
    socioName
}: PaymentRegistrationModalProps) {
    const [products, setProducts] = useState<Producto[]>([]);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    
    // Limits
    const [exceedsFlowers, setExceedsFlowers] = useState(false);
    const [exceedsGoteros, setExceedsGoteros] = useState(false);
    const [totalFlowersGrams, setTotalFlowersGrams] = useState(0);
    const [totalGoterosUnits, setTotalGoterosUnits] = useState(0);

    // Payments Form
    const [isBonificado, setIsBonificado] = useState(false);
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
            StoreService.getProductos(true)
                .then(setProducts)
                .catch(err => console.error("Error loading products:", err))
                .finally(() => setLoadingProducts(false));
        }
    }, [isOpen]);

    useEffect(() => {
        if (products.length > 0 && orderItems.length > 0) {
            let flowers = 0;
            let goteros = 0;

            orderItems.forEach(item => {
                const prod = products.find(p => p.id === item.productoId);
                if (prod) {
                    if (prod.tipo === 'flor') {
                        flowers += item.cantidad * (prod.peso_gramos || 1);
                    } else if (prod.tipo === 'gotero') {
                        goteros += item.cantidad;
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

    const handleConfirm = async () => {
        if (exceedsFlowers || exceedsGoteros) return; // Prevent saving if limits exceeded
        
        setSubmitting(true);
        try {
            if (isBonificado) {
                if (!bonificadoReason.trim()) {
                    alert("Por favor, ingresá el motivo del aporte bonificado.");
                    setSubmitting(false);
                    return;
                }
                // Donación / Bonificación
                await onConfirm([], true, bonificadoReason);
            } else {
                // Regular payment lines
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
                await onConfirm(formatted, false);
            }
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
                    <div className="bg-muted/30 p-4 rounded-xl border border-border/80">
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-wider block mb-2">Detalle de Dispensas del Pedido</span>
                        <div className="text-xs font-semibold text-foreground space-y-1.5">
                            {orderItems.map((item, idx) => (
                                <div key={idx} className="flex justify-between">
                                    <span>{item.productoNombre}</span>
                                    <span className="text-muted-foreground">x{item.cantidad}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Payment/Donation Option Select */}
                    {!(exceedsFlowers || exceedsGoteros) && (
                        <div className="space-y-4">
                            <label className="flex items-center gap-2.5 cursor-pointer bg-muted/20 p-3 rounded-xl border hover:bg-muted/40 transition-colors">
                                <input
                                    type="checkbox"
                                    className="w-5 h-5 rounded border-input text-primary focus:ring-primary"
                                    checked={isBonificado}
                                    onChange={e => setIsBonificado(e.target.checked)}
                                />
                                <div className="text-xs">
                                    <strong className="text-foreground font-black block">Aporte institucional bonificado (Sin cargo)</strong>
                                    <span className="text-muted-foreground block text-[11px] mt-0.5">Marcar si esta entrega corresponde a un tratamiento médico bonificado por razones extraordinarias.</span>
                                </div>
                            </label>

                            {isBonificado ? (
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
                                                            type="number"
                                                            min="1"
                                                            placeholder="0"
                                                            value={line.amount || ''}
                                                            onChange={e => updateLine(line.id, 'amount', Math.max(0, parseInt(e.target.value) || 0))}
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
