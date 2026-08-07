"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { StoreService } from '@/services/storeService';
import { Pedido, Socio, ProductoWithStockInfo } from '@/types';
import { 
    MapPin, 
    Phone, 
    ExternalLink, 
    Check, 
    Search, 
    Package, 
    Clock, 
    AlertTriangle, 
    ChevronRight, 
    User,
    ClipboardList,
    Smartphone
} from 'lucide-react';

export default function PickingPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    // Data State
    const [orders, setOrders] = useState<Pedido[]>([]);
    const [productsStock, setProductsStock] = useState<ProductoWithStockInfo[]>([]);
    const [socios, setSocios] = useState<Socio[]>([]);
    const [loading, setLoading] = useState(true);

    // Interaction State
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Tab Navigation for Mobile (< 768px)
    const [activeTab, setActiveTab] = useState<'lista' | 'detalle'>('lista');

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
            const [allOrders, stockInfo, allSocios] = await Promise.all([
                StoreService.getAllPedidos(false),
                StoreService.getVariedadesWithStockInfo(),
                StoreService.getAllSocios()
            ]);
            
            // Filter only pending, confirmed, or in preparation orders
            const pendingOrders = allOrders.filter(o => 
                o.estado === 'pendiente' || 
                o.estado === 'confirmado' || 
                o.estado === 'en_preparacion'
            );
            
            setOrders(pendingOrders);
            setProductsStock(stockInfo);
            setSocios(allSocios);
        } catch (error) {
            console.error("Error fetching picking data:", error);
        } finally {
            setLoading(false);
        }
    };

    // Filter orders
    const filteredOrders = orders.filter(o => {
        const socio = socios.find(s => s.id === o.socioId);
        const socioName = socio ? `${socio.nombre} ${socio.apellido}`.toLowerCase() : '';
        const socioDni = socio ? socio.dni : '';
        const searchLower = searchTerm.toLowerCase();
        
        return (
            o.id.substring(0, 8).includes(searchLower) ||
            socioName.includes(searchLower) ||
            socioDni.includes(searchLower)
        );
    });

    const handleSelectOrder = (orderId: string) => {
        setSelectedOrderId(orderId);
        setCheckedItems({}); // Reset checkboxes for the new order
        setActiveTab('detalle'); // Auto switch tab on mobile
    };

    const handleToggleCheckItem = (itemId: string) => {
        setCheckedItems(prev => ({
            ...prev,
            [itemId]: !prev[itemId]
        }));
    };

    const selectedOrder = orders.find(o => o.id === selectedOrderId);
    const selectedSocio = selectedOrder ? socios.find(s => s.id === selectedOrder.socioId) : null;
    
    // Clean telephone for WhatsApp link
    const cleanPhone = selectedSocio?.telefono 
        ? selectedSocio.telefono.replace(/[^0-9]/g, '') 
        : '';
        
    const whatsappLink = `https://wa.me/${cleanPhone}`;
    const mapsLink = selectedOrder?.direccionEntrega 
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedOrder.direccionEntrega)}` 
        : '';

    // Check if all items in selected order are checked
    const allItemsChecked = selectedOrder 
        ? selectedOrder.items.every(item => checkedItems[item.productoId]) 
        : false;

    const handleConfirmPacking = async () => {
        if (!selectedOrderId || isSubmitting) return;

        setIsSubmitting(true);
        try {
            await StoreService.updatePedidoStatus(selectedOrderId, 'listo_para_retiro');
            alert("Pedido empaquetado y marcado como listo para retiro.");
            
            // Clear selection and switch view back to list
            setSelectedOrderId(null);
            setCheckedItems({});
            setActiveTab('lista');
            
            // Refresh lists in real-time
            await fetchData();
        } catch (error) {
            console.error("Error confirming picking status:", error);
            alert("Hubo un error al confirmar el armado del pedido.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (authLoading || (loading && orders.length === 0)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-muted-foreground font-medium text-sm">Cargando módulo de picking...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Package className="text-primary" size={26} />
                        Armado de Pedidos y Picking
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Preparación de stock físico y logística de depósito.
                    </p>
                </div>
                
                {/* Mobile Tab Navigator */}
                <div className="flex md:hidden w-full bg-muted p-1 rounded-xl">
                    <button
                        onClick={() => setActiveTab('lista')}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'lista'
                                ? 'bg-card text-foreground shadow-sm'
                                : 'text-muted-foreground'
                        }`}
                    >
                        <ClipboardList size={16} />
                        Lista ({filteredOrders.length})
                    </button>
                    <button
                        onClick={() => {
                            if (selectedOrderId) {
                                setActiveTab('detalle');
                            } else {
                                alert("Selecciona un pedido primero.");
                            }
                        }}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'detalle'
                                ? 'bg-card text-foreground shadow-sm'
                                : 'text-muted-foreground'
                        } ${!selectedOrderId ? 'opacity-40' : ''}`}
                    >
                        <Smartphone size={16} />
                        Preparar
                    </button>
                </div>
            </div>

            {/* Content Container */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                
                {/* 1. ORDERS LIST PANEL (Visible on Desktop OR when Tab is 'lista' on Mobile) */}
                <div className={`md:col-span-2 space-y-4 ${activeTab === 'lista' ? 'block' : 'hidden md:block'}`}>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por ID, socio o DNI..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-card text-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all shadow-sm"
                        />
                    </div>

                    <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                        {filteredOrders.length === 0 ? (
                            <div className="text-center py-12 bg-card rounded-2xl border border-dashed p-6">
                                <Package className="mx-auto text-muted-foreground/40 mb-3" size={32} />
                                <p className="text-sm font-medium text-foreground">No hay pedidos pendientes</p>
                                <p className="text-xs text-muted-foreground mt-1">Todos los pedidos han sido armados 🌱.</p>
                            </div>
                        ) : (
                            filteredOrders.map(order => {
                                const socio = socios.find(s => s.id === order.socioId);
                                const isSelected = order.id === selectedOrderId;
                                const dateFormatted = new Date(order.fechaCreacion).toLocaleDateString('es-AR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                });
                                
                                return (
                                    <div
                                        key={order.id}
                                        onClick={() => handleSelectOrder(order.id)}
                                        className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                                            isSelected
                                                ? 'bg-primary/5 border-primary shadow-sm ring-1 ring-primary/20'
                                                : 'bg-card hover:bg-muted/30 border-border hover:border-muted'
                                        }`}
                                    >
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs font-bold text-primary">
                                                    #{order.id.substring(0, 8).toUpperCase()}
                                                </span>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                                                    order.tipoPedido === 'delivery'
                                                        ? 'bg-amber-100 text-amber-700'
                                                        : 'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {order.tipoPedido === 'delivery' ? '🛵 Envío' : '🏢 Retiro'}
                                                </span>
                                            </div>
                                            <p className="text-sm font-bold truncate text-foreground">
                                                {socio ? `${socio.nombre} ${socio.apellido}` : 'Socio Desconocido'}
                                            </p>
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <Clock size={12} />
                                                <span>{dateFormatted}</span>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="text-muted-foreground shrink-0" />
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* 2. PICKING DETAILS PANEL (Visible on Desktop OR when Tab is 'detalle' on Mobile) */}
                <div className={`md:col-span-3 ${activeTab === 'detalle' ? 'block' : 'hidden md:block'}`}>
                    {selectedOrder ? (
                        <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-6">
                            
                            {/* Order Details Header */}
                            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-4 border-b border-dashed">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-mono font-black text-lg text-primary">
                                            #{selectedOrder.id.substring(0, 8).toUpperCase()}
                                        </span>
                                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full capitalize ${
                                            selectedOrder.tipoPedido === 'delivery'
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-blue-100 text-blue-700'
                                        }`}>
                                            {selectedOrder.tipoPedido === 'delivery' ? '🛵 Envío a domicilio' : '🏢 Retiro en sede'}
                                        </span>
                                    </div>
                                    <h2 className="text-lg font-extrabold flex items-center gap-1.5 text-foreground">
                                        <User size={18} className="opacity-60" />
                                        {selectedSocio ? `${selectedSocio.nombre} ${selectedSocio.apellido}` : 'Socio Desconocido'}
                                    </h2>
                                    <p className="text-xs text-muted-foreground">
                                        DNI: {selectedSocio?.dni || 'N/A'} • Email: {selectedSocio?.email || 'N/A'}
                                    </p>
                                </div>
                                
                                {/* Status tag */}
                                <div className="text-right shrink-0">
                                    <span className="text-[10px] uppercase tracking-widest font-black text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-lg">
                                        {selectedOrder.estado}
                                    </span>
                                </div>
                            </div>

                            {/* Logistics Widget for Delivery */}
                            {selectedOrder.tipoPedido === 'delivery' && (
                                <div className="p-4 bg-muted/40 border rounded-xl space-y-3">
                                    <div className="flex items-start gap-2">
                                        <MapPin className="text-destructive mt-0.5 shrink-0" size={18} />
                                        <div>
                                            <p className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Dirección de entrega</p>
                                            <p className="text-sm font-semibold text-foreground leading-relaxed">
                                                {selectedOrder.direccionEntrega || 'No especificada'}
                                            </p>
                                            {selectedOrder.localidad && (
                                                <p className="text-xs font-medium text-muted-foreground">{selectedOrder.localidad}</p>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Tactile Big Action Buttons */}
                                    <div className="grid grid-cols-2 gap-3 pt-2">
                                        {selectedOrder.direccionEntrega && (
                                            <a
                                                href={mapsLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center justify-center gap-2 bg-card hover:bg-muted border py-3 px-4 rounded-xl text-xs font-bold transition-all text-foreground shadow-sm"
                                            >
                                                <ExternalLink size={14} />
                                                Abrir en Mapa
                                            </a>
                                        )}
                                        {selectedSocio?.telefono && (
                                            <a
                                                href={whatsappLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-xl text-xs font-bold transition-all shadow-sm"
                                            >
                                                <Phone size={14} />
                                                Contactar Socio
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Picking Checklist Items */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                                    <Check size={16} />
                                    Lista de Preparación
                                </h3>

                                <div className="space-y-3">
                                    {selectedOrder.items.map(item => {
                                        const stockInfo = productsStock.find(p => p.id === item.productoId);
                                        const isChecked = !!checkedItems[item.productoId];
                                        
                                        // Calculate other pending reservation stock for this variety
                                        const otherReserved = stockInfo 
                                            ? Math.max(0, stockInfo.stock_reservado - item.cantidad) 
                                            : 0;
                                        const otherReservedCount = stockInfo 
                                            ? Math.max(0, stockInfo.pedidos_reservados_count - 1) 
                                            : 0;

                                        return (
                                            <div 
                                                key={item.productoId}
                                                onClick={() => handleToggleCheckItem(item.productoId)}
                                                className={`p-4 border rounded-xl transition-all cursor-pointer flex items-start gap-3 select-none ${
                                                    isChecked 
                                                        ? 'bg-green-50/40 border-green-200' 
                                                        : 'bg-card border-border hover:border-muted-foreground/30'
                                                }`}
                                            >
                                                {/* Big Touch Checkbox */}
                                                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                                                    isChecked 
                                                        ? 'bg-green-600 border-green-600 text-white' 
                                                        : 'border-muted-foreground/40 bg-card'
                                                }`}>
                                                    {isChecked && <Check size={16} strokeWidth={3} />}
                                                </div>

                                                <div className="flex-1 min-w-0 space-y-2">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div>
                                                            <h4 className="text-sm font-bold text-foreground leading-tight">
                                                                {item.productoNombre}
                                                            </h4>
                                                            <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded capitalize">
                                                                {stockInfo?.categoria || 'Variedad'}
                                                            </span>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="text-sm font-black text-primary">
                                                                Requerido: {item.cantidad}g
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Stock Info Panels inside Item card */}
                                                    <div className="flex flex-wrap gap-2 text-xs pt-1">
                                                        <span className={`px-2 py-0.5 rounded-md font-semibold ${
                                                            (stockInfo?.stock_disponible || 0) <= 0 
                                                                ? 'bg-red-50 text-red-600 border border-red-100' 
                                                                : 'bg-blue-50 text-blue-600 border border-blue-100'
                                                        }`}>
                                                            Disponible libre: {stockInfo?.stock_disponible || 0}g
                                                        </span>
                                                        
                                                        {otherReserved > 0 && (
                                                            <span className="bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1">
                                                                <AlertTriangle size={10} />
                                                                {otherReserved}g reservado en otros {otherReservedCount} pedido{otherReservedCount !== 1 ? 's' : ''}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Confirm Action Button */}
                            <div className="pt-4 border-t">
                                <button
                                    onClick={handleConfirmPacking}
                                    disabled={!allItemsChecked || isSubmitting}
                                    className={`w-full py-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-md ${
                                        allItemsChecked && !isSubmitting
                                            ? 'bg-primary text-primary-foreground hover:bg-primary/95 active:scale-[0.98]'
                                            : 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
                                    }`}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
                                            <span>Procesando armado...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Check size={18} strokeWidth={2.5} />
                                            <span>Confirmar Armado y Empaquetado</span>
                                        </>
                                    )}
                                </button>
                                {!allItemsChecked && (
                                    <p className="text-[11px] text-center text-muted-foreground mt-2 font-medium">
                                        Debes chequear todos los productos antes de confirmar el empaque.
                                    </p>
                                )}
                            </div>

                        </div>
                    ) : (
                        <div className="hidden md:flex flex-col items-center justify-center bg-card border rounded-2xl p-12 text-center h-[50vh]">
                            <Package className="text-muted-foreground/30 mb-4" size={48} />
                            <h3 className="text-base font-bold text-foreground">Ningún pedido seleccionado</h3>
                            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                                Selecciona un pedido de la lista para comenzar a armar el paquete y verificar el stock en depósito.
                            </p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
