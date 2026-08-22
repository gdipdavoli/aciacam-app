"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { StoreService } from '@/services/storeService';
import { EmailService } from '@/services/emailService';
import { Pago, Socio, CierreMensual } from '@/types';
import { 
    Coins, 
    Search, 
    ArrowLeft, 
    DollarSign, 
    Calendar, 
    CreditCard, 
    FileText, 
    Printer, 
    Mail, 
    Trash2, 
    UserCheck, 
    AlertCircle, 
    CheckCircle, 
    RefreshCw, 
    Activity, 
    MapPin, 
    ShieldCheck,
    X
} from 'lucide-react';

export default function AdminPagosPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    // Navigation Tabs: 'caja' | 'cierres'
    const [activeTab, setActiveTab] = useState<'caja' | 'cierres'>('caja');

    // Caja State
    const [pagos, setPagos] = useState<Pago[]>([]);
    const [socios, setSocios] = useState<Socio[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Cierres State
    const [selectedSocioId, setSelectedSocioId] = useState<string>('');
    const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [cierreLoading, setCierreLoading] = useState(false);
    const [cierreExistente, setCierreExistente] = useState<CierreMensual | null>(null);
    const [cierrePreviewData, setCierrePreviewData] = useState<any | null>(null);

    // Email Sending & Annulment States
    const [sendingEmail, setSendingEmail] = useState(false);
    const [annulling, setAnnulling] = useState(false);
    const [showAnnulPrompt, setShowAnnulPrompt] = useState(false);
    const [annulReason, setAnnulReason] = useState('');

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }
            fetchData();
        }
    }, [user, authLoading, router]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [allPagos, allSocios] = await Promise.all([
                StoreService.getAllPagos(),
                StoreService.getAllSocios()
            ]);
            setPagos(allPagos);
            setSocios(allSocios.sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`)));
        } catch (error) {
            console.error("Error fetching payments:", error);
        } finally {
            setLoading(false);
        }
    };

    // Filter payments by search term (socio name, concept, or payment method)
    const filteredPagos = pagos.filter(p => {
        const socio = socios.find(s => s.id === p.socioId);
        const socioName = socio ? `${socio.nombre} ${socio.apellido}`.toLowerCase() : '';
        const searchLower = searchTerm.toLowerCase();

        return (
            socioName.includes(searchLower) ||
            p.concepto.toLowerCase().includes(searchLower) ||
            p.medioDePago.toLowerCase().includes(searchLower) ||
            (p.referencia && p.referencia.toLowerCase().includes(searchLower))
        );
    });

    const totalCaja = filteredPagos.reduce((acc, p) => acc + p.monto, 0);

    // Cierre Consult Handler
    const handleConsultCierre = async () => {
        if (!selectedSocioId || !selectedPeriod) return;
        setCierreLoading(true);
        setCierreExistente(null);
        setCierrePreviewData(null);

        try {
            // 1. Fetch if close already exists
            const cierre = await StoreService.getCierreMensual(selectedSocioId, selectedPeriod);
            if (cierre) {
                setCierreExistente(cierre);
            } else {
                // 2. If it does not exist, fetch live data to generate a preview
                const socioObj = socios.find(s => s.id === selectedSocioId);
                if (!socioObj) throw new Error("Socio no encontrado");

                const [mesPedidos, mesPagos] = await Promise.all([
                    StoreService.getPedidosBySocioAndMonth(selectedSocioId, selectedPeriod),
                    StoreService.getPagosBySocioAndMonth(selectedSocioId, selectedPeriod)
                ]);

                // Map dispensas
                const dispensas = mesPedidos.map(p => ({
                    pedidoId: p.id,
                    fecha: p.fechaCreacion,
                    items: p.items,
                    operador: 'Sistema ACIACAM'
                }));

                // Map aportes
                const aportes = mesPagos.map(pa => ({
                    fecha: pa.fecha,
                    concepto: pa.concepto,
                    medioDePago: pa.medioDePago,
                    referencia: pa.referencia,
                    monto: pa.monto
                }));

                const pieLegal = "Los importes consignados corresponden exclusivamente a aportes voluntarios destinados al sostenimiento del programa de cultivo solidario desarrollado por la Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal (ACIACAM), en cumplimiento de su Estatuto Social, de la Ley 27.350, su Decreto Reglamentario 883/2020, la Resolución MS 800/2021 y demás normativa aplicable. Dichos aportes no constituyen precio de venta ni contraprestación comercial por los productos dispensados.";

                setCierrePreviewData({
                    socio: socioObj,
                    dispensas,
                    aportes,
                    version_pie_legal: 1,
                    pie_legal: pieLegal
                });
            }
        } catch (error) {
            console.error("Error consulting close:", error);
            alert("Ocurrió un error al consultar la constancia.");
        } finally {
            setCierreLoading(false);
        }
    };

    // Generate Cierre Handler
    const handleGenerarCierre = async () => {
        if (!selectedSocioId || !selectedPeriod || !cierrePreviewData || !user) return;

        const confirmMsg = "Al generar el cierre mensual, la información de aportes y dispensas del período quedará congelada de forma inmutable para auditoría legal. ¿Deseas proceder?";
        if (!window.confirm(confirmMsg)) return;

        setCierreLoading(true);
        try {
            const nuevoCierre = await StoreService.createCierreMensual(
                selectedSocioId,
                selectedPeriod,
                cierrePreviewData,
                user.id
            );
            alert(`Cierre mensual generado con éxito. Constancia N° ${nuevoCierre.numeroConstancia}`);
            setCierreExistente(nuevoCierre);
            setCierrePreviewData(null);
        } catch (error: any) {
            console.error("Error generating close:", error);
            alert(error.message || "Error al generar el cierre mensual.");
        } finally {
            setCierreLoading(false);
        }
    };

    // Email Sending Handler
    const handleSendEmail = async () => {
        const cierre = cierreExistente;
        if (!cierre) return;
        const socioEmail = cierre.datos.socio?.email;
        if (!socioEmail) {
            alert("El socio no posee un correo electrónico registrado en su ficha.");
            return;
        }

        setSendingEmail(true);
        try {
            const socioName = `${cierre.datos.socio.nombre} ${cierre.datos.socio.apellido}`;
            await EmailService.sendCierreEmail(socioEmail, socioName, cierre.periodo, cierre);
            alert(`Constancia enviada con éxito al correo del socio: ${socioEmail}`);
        } catch (error: any) {
            console.error("Error sending closing email:", error);
            alert(error.message || "Hubo un error al enviar el email.");
        } finally {
            setSendingEmail(false);
        }
    };

    // Cierre Annulment Handler
    const handleAnnulCierre = async () => {
        const cierre = cierreExistente;
        if (!cierre || !user) return;
        if (!annulReason.trim()) {
            alert("Por favor, ingresá el motivo de la anulación.");
            return;
        }

        setAnnulling(true);
        try {
            await StoreService.anularCierreMensual(cierre.id, annulReason, user.id);
            alert("Constancia mensual anulada correctamente.");
            setShowAnnulPrompt(false);
            setAnnulReason('');
            // Reload closure
            await handleConsultCierre();
        } catch (error: any) {
            console.error("Error annulling close:", error);
            alert(error.message || "Error al anular la constancia.");
        } finally {
            setAnnulling(false);
        }
    };

    // Native Printing Trigger
    const handlePrint = () => {
        window.print();
    };

    if (authLoading || loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-muted-foreground font-medium text-sm">Cargando pagos y cierres...</p>
            </div>
        );
    }

    // Render close data: either existing or preview
    const renderedCierre = cierreExistente || {
        datos: cierrePreviewData,
        numeroConstancia: 'PRE-VISTA',
        fechaGeneracion: new Date().toISOString(),
        estado: 'emitido',
        hashSha256: 'SIN CONGELAR (Pendiente de emisión)'
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-12 no-print">
            
            {/* Print Styles Injection */}
            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    body {
                        background-color: white !important;
                        color: black !important;
                    }
                    .no-print {
                        display: none !important;
                    }
                    .print-only {
                        display: block !important;
                    }
                    /* For print output optimization */
                    #cierre-printable-area {
                        display: block !important;
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        background-color: white !important;
                        color: black !important;
                        padding: 1.5cm !important;
                        box-shadow: none !important;
                        border: none !important;
                    }
                }
                .print-only {
                    display: none;
                }
            `}} />

            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => router.back()} className="p-2 hover:bg-muted rounded-xl transition-colors">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Coins className="text-primary" size={26} />
                        Administración de Aportes y Cierres
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Historial de transacciones de caja y emisiones de constancias mensuales.
                    </p>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-border gap-2">
                <button
                    onClick={() => setActiveTab('caja')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                        activeTab === 'caja' 
                            ? 'border-primary text-primary' 
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <Activity size={16} />
                    Control de Caja
                </button>
                <button
                    onClick={() => setActiveTab('cierres')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                        activeTab === 'cierres' 
                            ? 'border-primary text-primary' 
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <FileText size={16} />
                    Constancias de Cierre Mensual
                </button>
            </div>

            {/* Tab CONTENT: CAJA */}
            {activeTab === 'caja' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                    {/* Metrics Panel */}
                    <div className="bg-card border rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="space-y-1">
                            <p className="text-xs uppercase font-black text-muted-foreground tracking-wider">Caja Total Acumulada (Filtrado)</p>
                            <p className="text-3xl font-black text-primary">
                                ${totalCaja.toLocaleString('es-AR')}
                            </p>
                        </div>
                        <div className="text-xs text-muted-foreground bg-muted px-3.5 py-2 rounded-xl">
                            Se muestran {filteredPagos.length} transacciones registradas.
                        </div>
                    </div>

                    {/* Filter Bar */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por socio, concepto, medio de pago, referencia..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-card text-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all shadow-sm"
                        />
                    </div>

                    {/* Payments List Table */}
                    <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr className="bg-muted/40 border-b text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                        <th className="p-4">Socio</th>
                                        <th className="p-4">Fecha</th>
                                        <th className="p-4">Concepto</th>
                                        <th className="p-4">Medio de Pago / Ref</th>
                                        <th className="p-4 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {filteredPagos.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="p-8 text-center text-muted-foreground italic">
                                                No se encontraron aportes registrados con ese criterio.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredPagos.map(pago => {
                                            const socio = socios.find(s => s.id === pago.socioId);
                                            const dateStr = new Date(pago.fecha).toLocaleDateString('es-AR', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                year: 'numeric'
                                            });

                                            return (
                                                <tr key={pago.id} className="hover:bg-muted/20 transition-colors">
                                                    <td className="p-4">
                                                        <div className="font-bold text-foreground">
                                                            {socio ? `${socio.apellido}, ${socio.nombre}` : 'Socio Desconocido'}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            DNI: {socio?.dni || 'N/A'}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-muted-foreground whitespace-nowrap">
                                                        <div className="flex items-center gap-1.5">
                                                            <Calendar size={14} className="opacity-60" />
                                                            {dateStr}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 font-medium text-foreground">
                                                        {pago.concepto}
                                                    </td>
                                                    <td className="p-4 text-muted-foreground whitespace-nowrap">
                                                        <div className="flex flex-col gap-0.5 justify-center">
                                                            <span className="capitalize font-bold text-foreground text-xs flex items-center gap-1">
                                                                <CreditCard size={12} className="opacity-60" />
                                                                {pago.medioDePago === 'transferencia_galicia' ? 'Galicia Transferencia' : 
                                                                 pago.medioDePago === 'mercadopago' ? 'MercadoPago' : 
                                                                 pago.medioDePago === 'efectivo' ? 'Efectivo' : pago.medioDePago}
                                                            </span>
                                                            {pago.referencia && (
                                                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono border">
                                                                    Ref: {pago.referencia}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-right font-black text-primary">
                                                        ${pago.monto.toLocaleString('es-AR')}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Tab CONTENT: CIERRES */}
            {activeTab === 'cierres' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                    
                    {/* Filter controls */}
                    <div className="bg-card border rounded-2xl p-6 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div>
                            <label className="text-xs font-black uppercase text-muted-foreground block mb-2">Seleccionar Socio</label>
                            <select
                                value={selectedSocioId}
                                onChange={e => setSelectedSocioId(e.target.value)}
                                className="w-full p-2.5 text-sm border rounded-xl bg-background text-foreground"
                            >
                                <option value="">-- Seleccionar Socio --</option>
                                {socios.map(soc => (
                                    <option key={soc.id} value={soc.id}>
                                        {soc.apellido}, {soc.nombre} (DNI: {soc.dni || 'N/A'})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-black uppercase text-muted-foreground block mb-2">Seleccionar Período</label>
                            <input
                                type="month"
                                value={selectedPeriod}
                                onChange={e => setSelectedPeriod(e.target.value)}
                                className="w-full p-2 text-sm border rounded-xl bg-background text-foreground"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleConsultCierre}
                            disabled={cierreLoading || !selectedSocioId}
                            className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-primary-foreground font-black text-sm rounded-xl transition-all shadow disabled:opacity-50"
                        >
                            {cierreLoading ? 'Consultando...' : 'Consultar Constancia'}
                        </button>
                    </div>

                    {/* Closure Render Area */}
                    {cierreLoading ? (
                        <div className="text-center py-12 text-muted-foreground flex flex-col items-center justify-center gap-3">
                            <RefreshCw className="animate-spin text-primary" size={32} />
                            <p className="text-sm font-semibold">Buscando datos del cierre mensual...</p>
                        </div>
                    ) : (cierreExistente || cierrePreviewData) ? (
                        <div className="space-y-6">
                            
                            {/* Action Bar */}
                            <div className="bg-muted/40 border p-4 rounded-2xl flex flex-wrap gap-3 items-center justify-between">
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="font-bold text-muted-foreground">Estado Constancia:</span>
                                    {renderedCierre.estado === 'anulado' ? (
                                        <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded font-black uppercase tracking-wider text-[10px]">ANULADO</span>
                                    ) : cierreExistente ? (
                                        <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded font-black uppercase tracking-wider text-[10px]">CONGELADO E INMUTABLE</span>
                                    ) : (
                                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded font-black uppercase tracking-wider text-[10px]">PRE-VISTA (No Generado)</span>
                                    )}
                                </div>

                                <div className="flex gap-2">
                                    {/* Generate button (only for preview) */}
                                    {!cierreExistente && (
                                        <button
                                            type="button"
                                            onClick={handleGenerarCierre}
                                            className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-xl text-xs font-black shadow flex items-center gap-1.5"
                                        >
                                            <ShieldCheck size={14} />
                                            Generar Cierre Mensual
                                        </button>
                                    )}

                                    {/* Printer button */}
                                    <button
                                        type="button"
                                        onClick={handlePrint}
                                        className="px-4 py-2 bg-card border hover:bg-muted text-foreground rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                    >
                                        <Printer size={14} />
                                        Imprimir Constancia
                                    </button>

                                    {/* Email sending */}
                                    {cierreExistente && cierreExistente.estado !== 'anulado' && (
                                        <button
                                            type="button"
                                            onClick={handleSendEmail}
                                            disabled={sendingEmail}
                                            className="px-4 py-2 bg-primary hover:bg-primary/95 text-primary-foreground rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                            {sendingEmail ? (
                                                <RefreshCw className="animate-spin" size={14} />
                                            ) : (
                                                <Mail size={14} />
                                            )}
                                            Enviar por Email
                                        </button>
                                    )}

                                    {/* Annulment button */}
                                    {cierreExistente && cierreExistente.estado !== 'anulado' && (
                                        <button
                                            type="button"
                                            onClick={() => setShowAnnulPrompt(true)}
                                            className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                        >
                                            <Trash2 size={14} />
                                            Anular Cierre
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Annulment alert banner */}
                            {renderedCierre.estado === 'anulado' && (
                                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 p-4 rounded-2xl flex gap-3 text-red-800 dark:text-red-300">
                                    <AlertCircle className="shrink-0 text-red-600" size={24} />
                                    <div>
                                        <h4 className="text-xs font-black uppercase tracking-wider">Constancia Anulada</h4>
                                        <p className="text-xs mt-0.5">
                                            Este cierre mensual fue anulado el <strong>{new Date(cierreExistente?.fechaAnulacion || '').toLocaleDateString('es-AR')}</strong>.
                                        </p>
                                        <p className="text-xs mt-1 italic">
                                            Motivo: "{cierreExistente?.motivoAnulacion || 'Sin motivo especificado'}"
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* PREVIEW CONTAINER FOR WEB VIEW */}
                            <div className="bg-card border rounded-2xl p-8 shadow-md relative overflow-hidden max-w-3xl mx-auto border-border">
                                {renderedCierre.estado === 'anulado' && (
                                    <div className="absolute inset-0 z-10 flex items-center justify-center select-none pointer-events-none opacity-[0.08] dark:opacity-[0.04]">
                                        <span className="text-[120px] font-black tracking-widest border-[20px] border-red-600 p-12 text-red-600 uppercase -rotate-12">ANULADO</span>
                                    </div>
                                )}

                                {/* Block 1: Institutional Header */}
                                <div className="text-center pb-6 border-b border-dashed border-border/80">
                                    <h3 className="text-xl font-black text-foreground tracking-wide" style={{ color: '#0F3822' }}>ACIACAM</h3>
                                    <p className="text-xs text-muted-foreground mt-1 font-semibold">
                                        Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal
                                    </p>
                                    <div className="text-[10px] text-muted-foreground mt-2 grid grid-cols-2 gap-y-1 max-w-lg mx-auto font-medium">
                                        <div><strong>Personería Jurídica:</strong> N° 119/2023 (DPJ San Luis)</div>
                                        <div><strong>CUIT:</strong> 30-71825047-8</div>
                                        <div><strong>Expte. Salud/ONG:</strong> Expte. DI-2023-162-APN-DNRIEI#MS</div>
                                        <div><strong>Nº Trámite REPROCANN:</strong> Trámite Nº 340155</div>
                                    </div>
                                </div>

                                {/* Title */}
                                <div className="py-5 text-center">
                                    <h4 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Constancia Mensual de Aportes y Dispensas</h4>
                                    <p className="text-xs text-muted-foreground mt-1">Período: <span className="font-bold text-foreground">{selectedPeriod}</span></p>
                                </div>

                                {/* Block 2: Socio Info Box */}
                                <div className="bg-muted/30 border p-4 rounded-xl text-xs space-y-2">
                                    <div className="grid grid-cols-2 gap-y-1.5">
                                        <div><span className="text-muted-foreground font-semibold">Asociado:</span> <strong className="text-foreground">{renderedCierre.datos?.socio?.nombre} {renderedCierre.datos?.socio?.apellido}</strong></div>
                                        <div><span className="text-muted-foreground font-semibold">DNI:</span> <strong className="text-foreground">{renderedCierre.datos?.socio?.dni || 'N/A'}</strong></div>
                                        <div><span className="text-muted-foreground font-semibold">Nº Socio:</span> <strong className="text-foreground">{renderedCierre.datos?.socio?.numeroSocio || 'N/A'}</strong></div>
                                        <div><span className="text-muted-foreground font-semibold">Patología:</span> <strong className="text-foreground">{renderedCierre.datos?.socio?.diagnosticoPrincipal || 'N/A'}</strong></div>
                                    </div>
                                    <div className="border-t border-border pt-2 grid grid-cols-2 gap-y-1">
                                        <div><span className="text-muted-foreground font-semibold">REPROCANN N°:</span> <strong className="text-foreground">{renderedCierre.datos?.socio?.reprocann?.numeroTramite || 'N/A'}</strong></div>
                                        <div><span className="text-muted-foreground font-semibold">Vencimiento:</span> <strong className="text-foreground">{renderedCierre.datos?.socio?.reprocann?.vencimiento ? new Date(renderedCierre.datos.socio.reprocann.vencimiento).toLocaleDateString('es-AR') : 'N/A'}</strong></div>
                                    </div>
                                </div>

                                {/* Block 3: Dispensas details */}
                                <div className="mt-6 space-y-2">
                                    <h5 className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Detalle de Dispensas de Fitopreparados</h5>
                                    <div className="border border-border rounded-xl overflow-hidden text-xs">
                                        <table className="w-full text-left">
                                            <thead>
                                                <tr className="bg-muted/40 border-b font-bold text-muted-foreground">
                                                    <th className="p-2.5">Fecha</th>
                                                    <th className="p-2.5">Remito ID</th>
                                                    <th className="p-2.5">Detalle Dispensado</th>
                                                    <th className="p-2.5">Responsable</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {!renderedCierre.datos?.dispensas || renderedCierre.datos.dispensas.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={4} className="p-4 text-center text-muted-foreground italic">No se registraron dispensas en este período.</td>
                                                    </tr>
                                                ) : (
                                                    renderedCierre.datos.dispensas.map((disp: any, i: number) => (
                                                        <tr key={i} className="border-b border-border last:border-none">
                                                            <td className="p-2.5 text-muted-foreground whitespace-nowrap">{new Date(disp.fecha).toLocaleDateString('es-AR')}</td>
                                                            <td className="p-2.5 font-mono text-[10px] whitespace-nowrap">{disp.pedidoId.substring(0, 8)}</td>
                                                            <td className="p-2.5 font-semibold">
                                                                {disp.items.map((it: any, k: number) => (
                                                                    <div key={k}>{it.cantidad}x {it.productoNombre}</div>
                                                                ))}
                                                            </td>
                                                            <td className="p-2.5 text-muted-foreground">{disp.operador || 'Sistema'}</td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Block 4: Aportes details */}
                                <div className="mt-6 space-y-2">
                                    <h5 className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Detalle de Aportes Económicos</h5>
                                    <div className="border border-border rounded-xl overflow-hidden text-xs">
                                        <table className="w-full text-left">
                                            <thead>
                                                <tr className="bg-muted/40 border-b font-bold text-muted-foreground">
                                                    <th className="p-2.5">Fecha</th>
                                                    <th className="p-2.5">Concepto</th>
                                                    <th className="p-2.5">Medio de Pago / Ref</th>
                                                    <th className="p-2.5 text-right">Monto</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {!renderedCierre.datos?.aportes || renderedCierre.datos.aportes.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={4} className="p-4 text-center text-muted-foreground italic">No se registraron aportes económicos en este período.</td>
                                                    </tr>
                                                ) : (
                                                    renderedCierre.datos.aportes.map((apo: any, i: number) => (
                                                        <tr key={i} className="border-b border-border last:border-none">
                                                            <td className="p-2.5 text-muted-foreground whitespace-nowrap">{new Date(apo.fecha).toLocaleDateString('es-AR')}</td>
                                                            <td className="p-2.5 font-medium">{apo.concepto}</td>
                                                            <td className="p-2.5 text-muted-foreground text-[11px] whitespace-nowrap capitalize">
                                                                {apo.medioDePago === 'transferencia_galicia' ? 'Galicia Transf.' : 
                                                                 apo.medioDePago === 'mercadopago' ? 'MercadoPago' : 
                                                                 apo.medioDePago === 'efectivo' ? 'Efectivo' : apo.medioDePago}
                                                                {apo.referencia && <div className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded inline-block ml-1 border">Ref: {apo.referencia}</div>}
                                                            </td>
                                                            <td className="p-2.5 text-right font-bold text-foreground">
                                                                ${apo.monto.toLocaleString('es-AR')}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="text-right text-xs font-bold text-foreground pt-1.5">
                                        Total Aportado: ${(renderedCierre.datos?.aportes || []).reduce((acc: number, a: any) => acc + (a.monto || 0), 0).toLocaleString('es-AR')}
                                    </div>
                                </div>

                                {/* Block 5: Legal Frame and Signatures */}
                                <div className="mt-8 pt-4 border-t border-border space-y-4">
                                    <p className="text-[10px] text-muted-foreground text-justify leading-relaxed">
                                        {renderedCierre.datos?.pie_legal}
                                    </p>

                                    <div className="grid grid-cols-2 gap-12 pt-8 text-center text-[10px]">
                                        <div className="space-y-1">
                                            <div className="border-b border-border/80 h-10"></div>
                                            <span className="font-bold text-muted-foreground block uppercase">Responsable de Dispensa ACIACAM</span>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="border-b border-border/80 h-10"></div>
                                            <span className="font-bold text-muted-foreground block uppercase">Firma del Asociado / Recibido</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Document Info Footer */}
                                <div className="mt-12 pt-4 border-t border-dashed border-border/80 text-center text-[9px] text-muted-foreground space-y-0.5">
                                    <div><strong>Constancia N°:</strong> {renderedCierre.numeroConstancia} | <strong>Generado el:</strong> {new Date(renderedCierre.fechaGeneracion).toLocaleString('es-AR')}</div>
                                    <div className="font-mono truncate select-all" title="Copiar firma digital">
                                        <strong>Firma Criptográfica SHA-256:</strong> {renderedCierre.hashSha256}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 bg-card border rounded-2xl text-muted-foreground">
                            <AlertCircle className="mx-auto text-muted-foreground/30 mb-2" size={32} />
                            <p className="text-sm">Por favor, seleccioná un Socio y presiona "Consultar Constancia" para ver o emitir su cierre mensual.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ANNUL DIALOG POPUP */}
            {showAnnulPrompt && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
                    <div className="bg-card w-full max-w-md rounded-2xl shadow-xl border border-border overflow-hidden">
                        <div className="p-5 border-b border-border flex justify-between items-center">
                            <h3 className="text-base font-black text-foreground">Anular Cierre Mensual</h3>
                            <button onClick={() => setShowAnnulPrompt(false)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Esta acción marcará permanentemente la constancia como **ANULADA**. El documento no desaparecerá físicamente pero ya no tendrá validez institucional.
                            </p>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Motivo de Anulación (Requerido)</label>
                                <textarea
                                    placeholder="Ej: Corrección en las dispensas de flores registradas."
                                    required
                                    rows={3}
                                    value={annulReason}
                                    onChange={e => setAnnulReason(e.target.value)}
                                    className="w-full p-2.5 border rounded-xl bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                            </div>
                        </div>
                        <div className="bg-muted/40 p-4 border-t border-border flex justify-end gap-3">
                            <button
                                onClick={() => setShowAnnulPrompt(false)}
                                disabled={annulling}
                                className="px-4 py-2 hover:bg-muted rounded-xl text-xs font-bold text-muted-foreground"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAnnulCierre}
                                disabled={annulling || !annulReason.trim()}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black shadow disabled:opacity-50"
                            >
                                {annulling ? 'Anulando...' : 'Confirmar Anulación'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PRINT WRAPPER FOR NATIVE SYSTEM DIALOG (HIDDEN IN WEB VIEW) */}
            {(cierreExistente || cierrePreviewData) && (
                <div id="cierre-printable-area" className="print-only">
                    {/* Block 1: Institutional Header */}
                    <div style={{ textAlign: 'center', paddingBottom: '20px', borderBottom: '1px dashed #000' }}>
                        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 'bold' }}>ACIACAM</h2>
                        <p style={{ margin: '5px 0 0 0', fontSize: '12px' }}>
                            Asociación Civil para la Investigación y el Acceso del Cannabis Medicinal
                        </p>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', marginTop: '10px' }}>
                            <tbody>
                                <tr>
                                    <td><strong>Personería Jurídica:</strong> N° 119/2023 (DPJ San Luis)</td>
                                    <td style={{ textAlign: 'right' }}><strong>CUIT:</strong> 30-71825047-8</td>
                                </tr>
                                <tr>
                                    <td><strong>Expte. Salud/ONG:</strong> Expte. DI-2023-162-APN-DNRIEI#MS</td>
                                    <td style={{ textAlign: 'right' }}><strong>Nº Trámite REPROCANN:</strong> Trámite Nº 340155</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Title */}
                    <div style={{ padding: '20px 0', textAlign: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '15px', textTransform: 'uppercase', letterSpacing: '1px' }}>Constancia Mensual de Aportes y Dispensas</h3>
                        <p style={{ margin: '5px 0 0 0', fontSize: '12px' }}>Período: <strong>{selectedPeriod}</strong></p>
                        {renderedCierre.estado === 'anulado' && (
                            <h4 style={{ color: 'red', margin: '10px 0 0 0', border: '2px solid red', display: 'inline-block', padding: '5px 15px', textTransform: 'uppercase' }}>DOCUMENTO ANULADO</h4>
                        )}
                    </div>

                    {/* Block 2: Socio Info Box */}
                    <div style={{ border: '1px solid #000', padding: '12px', fontSize: '11px', lineHeight: '1.5' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '120px' }}><strong>Asociado:</strong></td>
                                    <td>{renderedCierre.datos?.socio?.nombre} {renderedCierre.datos?.socio?.apellido}</td>
                                    <td style={{ width: '100px' }}><strong>DNI:</strong></td>
                                    <td>{renderedCierre.datos?.socio?.dni || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td><strong>Nº Socio:</strong></td>
                                    <td>{renderedCierre.datos?.socio?.numeroSocio || 'N/A'}</td>
                                    <td><strong>Patología:</strong></td>
                                    <td>{renderedCierre.datos?.socio?.diagnosticoPrincipal || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td><strong>REPROCANN N°:</strong></td>
                                    <td>{renderedCierre.datos?.socio?.reprocann?.numeroTramite || 'N/A'}</td>
                                    <td><strong>Vencimiento:</strong></td>
                                    <td>{renderedCierre.datos?.socio?.reprocann?.vencimiento ? new Date(renderedCierre.datos.socio.reprocann.vencimiento).toLocaleDateString('es-AR') : 'N/A'}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Block 3: Dispensas details */}
                    <div style={{ marginTop: '20px' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '11px', textTransform: 'uppercase' }}>Detalle de Dispensas de Fitopreparados</h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #000', textAlign: 'left', fontWeight: 'bold' }}>
                                    <th style={{ padding: '6px' }}>Fecha</th>
                                    <th style={{ padding: '6px' }}>Remito ID</th>
                                    <th style={{ padding: '6px' }}>Detalle Dispensado</th>
                                    <th style={{ padding: '6px' }}>Responsable</th>
                                </tr>
                            </thead>
                            <tbody>
                                {!renderedCierre.datos?.dispensas || renderedCierre.datos.dispensas.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} style={{ padding: '10px', textAlign: 'center', fontStyle: 'italic' }}>No se registraron dispensas en este período.</td>
                                    </tr>
                                ) : (
                                    renderedCierre.datos.dispensas.map((disp: any, i: number) => (
                                        <tr key={i} style={{ borderBottom: '1px solid #ccc' }}>
                                            <td style={{ padding: '6px' }}>{new Date(disp.fecha).toLocaleDateString('es-AR')}</td>
                                            <td style={{ padding: '6px', fontFamily: 'monospace' }}>{disp.pedidoId.substring(0, 8)}</td>
                                            <td style={{ padding: '6px' }}>
                                                {disp.items.map((it: any, k: number) => (
                                                    <div key={k}>{it.cantidad}x {it.productoNombre}</div>
                                                ))}
                                            </td>
                                            <td style={{ padding: '6px' }}>{disp.operador || 'Sistema'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Block 4: Aportes details */}
                    <div style={{ marginTop: '20px' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '11px', textTransform: 'uppercase' }}>Detalle de Aportes Económicos</h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #000', textAlign: 'left', fontWeight: 'bold' }}>
                                    <th style={{ padding: '6px' }}>Fecha</th>
                                    <th style={{ padding: '6px' }}>Concepto</th>
                                    <th style={{ padding: '6px' }}>Medio de Pago / Ref</th>
                                    <th style={{ padding: '6px', textAlign: 'right' }}>Monto</th>
                                </tr>
                            </thead>
                            <tbody>
                                {!renderedCierre.datos?.aportes || renderedCierre.datos.aportes.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} style={{ padding: '10px', textAlign: 'center', fontStyle: 'italic' }}>No se registraron aportes económicos en este período.</td>
                                    </tr>
                                ) : (
                                    renderedCierre.datos.aportes.map((apo: any, i: number) => (
                                        <tr key={i} style={{ borderBottom: '1px solid #ccc' }}>
                                            <td style={{ padding: '6px' }}>{new Date(apo.fecha).toLocaleDateString('es-AR')}</td>
                                            <td style={{ padding: '6px' }}>{apo.concepto}</td>
                                            <td style={{ padding: '6px', textTransform: 'capitalize' }}>
                                                {apo.medioDePago === 'transferencia_galicia' ? 'Galicia Transf.' : 
                                                 apo.medioDePago === 'mercadopago' ? 'MercadoPago' : 
                                                 apo.medioDePago === 'efectivo' ? 'Efectivo' : apo.medioDePago}
                                                {apo.referencia && ` (Ref: ${apo.referencia})`}
                                            </td>
                                            <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>
                                                ${apo.monto.toLocaleString('es-AR')}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                        <div style={{ textAlign: 'right', fontSize: '11px', fontWeight: 'bold', marginTop: '10px' }}>
                            Total Aportado: ${(renderedCierre.datos?.aportes || []).reduce((acc: number, a: any) => acc + (a.monto || 0), 0).toLocaleString('es-AR')}
                        </div>
                    </div>

                    {/* Block 5: Legal Frame and Signatures */}
                    <div style={{ marginTop: '30px', paddingTop: '15px', borderTop: '1px solid #000' }}>
                        <p style={{ fontSize: '9px', textAlign: 'justify', lineHeight: '1.4', margin: 0 }}>
                            {renderedCierre.datos?.pie_legal}
                        </p>

                        {renderedCierre.estado === 'anulado' && (
                            <div style={{ border: '1px solid red', padding: '10px', margin: '15px 0', fontSize: '10px', color: 'red' }}>
                                <strong>MOTIVO DE ANULACIÓN:</strong> "{cierreExistente?.motivoAnulacion || 'Sin motivo especificado'}" - Anulado el {new Date(cierreExistente?.fechaAnulacion || '').toLocaleString('es-AR')}
                            </div>
                        )}

                        <table style={{ width: '100%', marginTop: '50px', fontSize: '9px' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '45%', textAlign: 'center' }}>
                                        <div style={{ borderBottom: '1px solid #000', height: '30px', margin: '0 20px' }}></div>
                                        <span style={{ fontWeight: 'bold', color: '#555', textTransform: 'uppercase', display: 'block', marginTop: '5px' }}>Responsable de Dispensa ACIACAM</span>
                                    </td>
                                    <td style={{ width: '10%' }}></td>
                                    <td style={{ width: '45%', textAlign: 'center' }}>
                                        <div style={{ borderBottom: '1px solid #000', height: '30px', margin: '0 20px' }}></div>
                                        <span style={{ fontWeight: 'bold', color: '#555', textTransform: 'uppercase', display: 'block', marginTop: '5px' }}>Firma del Asociado / Recibido</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Document Info Footer */}
                    <div style={{ marginTop: '60px', paddingTop: '10px', borderTop: '1px dashed #000', textAlign: 'center', fontSize: '8px', color: '#666' }}>
                        <div><strong>Constancia N°:</strong> {renderedCierre.numeroConstancia} | <strong>Generado el:</strong> {new Date(renderedCierre.fechaGeneracion).toLocaleString('es-AR')}</div>
                        <div><strong>Firma Criptográfica SHA-256:</strong> {renderedCierre.hashSha256}</div>
                    </div>
                </div>
            )}

        </div>
    );
}
