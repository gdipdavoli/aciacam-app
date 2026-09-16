"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { StoreService } from '@/services/storeService';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { 
    BarChart3, 
    TrendingUp, 
    TrendingDown, 
    Users, 
    Leaf, 
    DollarSign, 
    AlertTriangle,
    Download,
    Calendar,
    Search,
    ChevronRight,
    ArrowUpRight,
    ArrowDownRight,
    Sparkles,
    Award,
    Layers,
    Table as TableIcon,
    ChevronUp,
    ChevronDown,
    Check,
    X
} from 'lucide-react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    BarChart,
    Bar,
    Cell,
    PieChart,
    Pie,
    Legend,
    ComposedChart
} from 'recharts';

export default function EstadisticasPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [showSocioModal, setShowSocioModal] = useState<'active' | 'inactive' | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [data, setData] = useState<{
        pedidos: any[],
        socios: any[],
        productos: any[],
        pagos: any[]
    }>({ pedidos: [], socios: [], productos: [], pagos: [] });

    const [tempDateRange, setTempDateRange] = useState({
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });

    const [dateRange, setDateRange] = useState({
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });

    const fetchStats = async (start = tempDateRange.start, end = tempDateRange.end) => {
        setLoading(true);
        try {
            // Fetch all historical data so the Annual Chart has full multi-year context
            const res = await StoreService.getStatsData();
            setData(res);
            setDateRange({ start, end });
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }
            fetchStats(dateRange.start, dateRange.end);
        }
    }, [user, authLoading]);

    // --- LÓGICA DE CÁLCULOS ---

    const stats = useMemo(() => {
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);

        // Filtrar datos por rango seleccionado
        const filterByRange = (items: any[]) => {
            return items.filter(item => {
                const dateToUse = item.fechaRetiroPreferida || item.fechaCreacion || item.fecha;
                const d = new Date(dateToUse);
                if (typeof dateToUse === 'string' && dateToUse.length === 10) {
                    d.setHours(12, 0, 0, 0); 
                }
                return d >= startDate && d <= endDate;
            });
        };

        const currentRangePedidos = filterByRange(data.pedidos).filter(p => 
            p.estado !== 'cancelado' && p.estado !== 'pendiente'
        );
        const currentRangePagos = filterByRange(data.pagos);

        // Para variaciones, comparamos con el periodo anterior de la misma duración
        const rangeDuration = endDate.getTime() - startDate.getTime();
        const prevStartDate = new Date(startDate.getTime() - rangeDuration);
        const prevEndDate = new Date(endDate.getTime() - rangeDuration);

        const filterByPrevRange = (items: any[]) => {
            return items.filter(item => {
                const d = new Date(item.fechaCreacion || item.fecha);
                return d >= prevStartDate && d <= prevEndDate;
            });
        };

        const lastRangePedidos = filterByPrevRange(data.pedidos).filter(p => 
            p.estado !== 'cancelado' && p.estado !== 'pendiente'
        );
        const lastRangePagos = filterByPrevRange(data.pagos);

        // Cálculos de Gramos
        const getGrams = (pedidos: any[]) => {
            return pedidos.reduce((acc, p) => {
                const pGrams = p.items.reduce((sum: number, item: any) => {
                    const prod = data.productos.find(pr => pr.id === item.productoId);
                    return sum + (item.cantidad * (prod?.peso_gramos || 10));
                }, 0);
                return acc + pGrams;
            }, 0);
        };

        const totalGrams = getGrams(currentRangePedidos);
        const prevTotalGrams = getGrams(lastRangePedidos);
        
        // Socios que retiraron
        const currentSociosCount = new Set(currentRangePedidos.map(p => p.socioId)).size;
        const lastSociosCount = new Set(lastRangePedidos.map(p => p.socioId)).size;

        // Aportes
        const totalAportes = currentRangePagos.reduce((acc, p) => acc + (p.monto || 0), 0);
        const prevTotalAportes = lastRangePagos.reduce((acc, p) => acc + (p.monto || 0), 0);

        // Variaciones
        const getVariation = (curr: number, prev: number) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return ((curr - prev) / prev) * 100;
        };

        // Datos para gráfico diario/mensual según duración
        const diffDays = Math.ceil(rangeDuration / (1000 * 60 * 60 * 24));
        const chartData = [];
        
        if (diffDays <= 62) {
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dayStr = d.toISOString().split('T')[0];
                const dayGrams = currentRangePedidos
                    .filter(p => {
                        const dateToUse = p.fechaRetiroPreferida || p.fechaCreacion;
                        return new Date(dateToUse).toISOString().split('T')[0] === dayStr;
                    })
                    .reduce((acc, p) => acc + p.items.reduce((sum: number, item: any) => {
                        const prod = data.productos.find(pr => pr.id === item.productoId);
                        return sum + (item.cantidad * (prod?.peso_gramos || 10));
                    }, 0), 0);
                
                chartData.push({ name: d.getDate().toString() + '/' + (d.getMonth()+1), actual: dayGrams });
            }
        } else {
            const months: Record<string, number> = {};
            currentRangePedidos.forEach(p => {
                const m = new Date(p.fechaCreacion).toLocaleString('default', { month: 'short' });
                const g = p.items.reduce((sum: number, item: any) => {
                    const prod = data.productos.find(pr => pr.id === item.productoId);
                    return sum + (item.cantidad * (prod?.peso_gramos || 10));
                }, 0);
                months[m] = (months[m] || 0) + g;
            });
            Object.entries(months).forEach(([name, actual]) => chartData.push({ name, actual }));
        }

        // Variedades dispensadas
        const varietyMap: Record<string, number> = {};
        currentRangePedidos.forEach(p => {
            p.items.forEach((item: any) => {
                const prod = data.productos.find(pr => pr.id === item.productoId);
                const g = item.cantidad * (prod?.peso_gramos || 10);
                varietyMap[item.productoNombre] = (varietyMap[item.productoNombre] || 0) + g;
            });
        });

        const varietyData = Object.entries(varietyMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        // Socios con más retiros
        const socioStatsMap: Record<string, { id: string, name: string, dni: string, grams: number, orders: number }> = {};
        currentRangePedidos.forEach(p => {
            const socio = data.socios.find(s => s.id === p.socioId);
            const name = socio ? `${socio.nombre} ${socio.apellido}` : 'Desconocido';
            const dni = socio?.dni || '';
            const g = p.items.reduce((sum: number, item: any) => {
                const prod = data.productos.find(pr => pr.id === item.productoId);
                return sum + (item.cantidad * (prod?.peso_gramos || 10));
            }, 0);

            if (!socioStatsMap[p.socioId]) {
                socioStatsMap[p.socioId] = { id: p.socioId, name, dni, grams: 0, orders: 0 };
            }
            socioStatsMap[p.socioId].grams += g;
            socioStatsMap[p.socioId].orders += 1;
        });

        const allActiveSocios = Object.values(socioStatsMap)
            .sort((a, b) => b.grams - a.grams);

        const topSocios = allActiveSocios.slice(0, 10);

        const activeIds = new Set(Object.keys(socioStatsMap));
        const inactiveSocios = data.socios
            .filter(s => !activeIds.has(s.id) && s.rol === 'socio')
            .map(s => ({
                id: s.id,
                name: `${s.nombre} ${s.apellido}`,
                dni: s.dni,
                lastOrder: data.pedidos.find(p => p.socioId === s.id)?.fechaCreacion
            }))
            .sort((a, b) => {
                if (!a.lastOrder) return 1;
                if (!b.lastOrder) return -1;
                return new Date(b.lastOrder).getTime() - new Date(a.lastOrder).getTime();
            });

        // Alertas
        const alerts = [];
        data.productos.forEach(prod => {
            if (prod.stockDisponible < 20) {
                alerts.push({
                    type: 'warning',
                    title: `Stock bajo: ${prod.nombre}`,
                    message: `Quedan solo ${prod.stockDisponible} unidades disponibles.`
                });
            }
        });

        if (getVariation(totalAportes, prevTotalAportes) < -20) {
            alerts.push({
                type: 'critical',
                title: 'Caída de aportes',
                message: 'Los aportes económicos han caído más de un 20% respecto al mes pasado.'
            });
        }

        return {
            totalGrams,
            prevTotalGrams,
            gramsVariation: getVariation(totalGrams, prevTotalGrams),
            currentSociosCount,
            lastSociosCount,
            sociosVariation: getVariation(currentSociosCount, lastSociosCount),
            totalAportes,
            prevTotalAportes,
            aportesVariation: getVariation(totalAportes, prevTotalAportes),
            avgGramsPerSocio: currentSociosCount > 0 ? totalGrams / currentSociosCount : 0,
            chartData,
            varietyData,
            topSocios,
            allActiveSocios,
            inactiveSocios,
            alerts
        };
    }, [data, dateRange]);

    if (loading || authLoading) return <div className="p-8 text-center text-muted-foreground font-medium">Analizando datos y métricas históricas...</div>;

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Panel de Estadísticas</h1>
                    <p className="text-muted-foreground">Monitoreo de dispensación, sostenibilidad y tendencias anuales.</p>
                </div>
                <div className="flex flex-wrap gap-3 items-center bg-card border border-border p-3 rounded-2xl shadow-xs">
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Desde</label>
                        <input 
                            type="date" 
                            className="bg-background border border-input rounded-xl px-2.5 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            value={tempDateRange.start}
                            onChange={e => setTempDateRange(prev => ({ ...prev, start: e.target.value }))}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Hasta</label>
                        <input 
                            type="date" 
                            className="bg-background border border-input rounded-xl px-2.5 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            value={tempDateRange.end}
                            onChange={e => setTempDateRange(prev => ({ ...prev, end: e.target.value }))}
                        />
                    </div>
                    <button 
                        onClick={() => fetchStats()}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
                    >
                        Actualizar Rango
                    </button>
                    <div className="h-5 w-px bg-border mx-1 hidden md:block"></div>
                    <button 
                        onClick={() => {
                            const now = new Date();
                            const startStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                            const endStr = new Date().toISOString().split('T')[0];
                            setTempDateRange({ start: startStr, end: endStr });
                            fetchStats(startStr, endStr);
                        }}
                        className="text-xs font-bold text-primary hover:underline"
                    >
                        Mes Actual
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard 
                    title="Total Dispensado" 
                    value={`${stats.totalGrams}g`} 
                    icon={Leaf} 
                    variation={stats.gramsVariation} 
                    subtext="vs periodo anterior" 
                />
                <StatCard 
                    title="Socios Activos" 
                    value={stats.currentSociosCount.toString()} 
                    icon={Users} 
                    variation={stats.sociosVariation} 
                    subtext="con retiros este periodo" 
                />
                <StatCard 
                    title="Total Aportes" 
                    value={`$${stats.totalAportes.toLocaleString()}`} 
                    icon={DollarSign} 
                    variation={stats.aportesVariation} 
                    subtext="monto total recaudado" 
                />
                <StatCard 
                    title="Promedio/Socio" 
                    value={`${stats.avgGramsPerSocio.toFixed(1)}g`} 
                    icon={BarChart3} 
                    variation={0} 
                    subtext="gramos por socio activo" 
                />
            </div>

            {/* --- COMPONENTE PRINCIPAL: COMPARATIVA ANUAL DE DISPENSA MENSUAL --- */}
            <AnnualDispensationChart data={data} />

            {/* Gráfico de Demanda por Rango Seleccionado (Línea/Área Corta) */}
            <div className="bg-card p-6 rounded-2xl border border-border/80 shadow-xs">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-foreground">
                        <TrendingUp size={20} className="text-primary" />
                        Evolución en Rango Seleccionado
                    </h3>
                    <div className="text-xs text-muted-foreground font-semibold">
                        {dateRange.start} al {dateRange.end}
                    </div>
                </div>
                <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats.chartData}>
                            <defs>
                                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25}/>
                                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.6)" />
                            <XAxis 
                                dataKey="name" 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                                dy={10}
                            />
                            <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <Tooltip 
                                contentStyle={{ 
                                    backgroundColor: 'hsl(var(--card))', 
                                    borderColor: 'hsl(var(--border))',
                                    borderRadius: '12px',
                                    fontSize: '12px',
                                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)'
                                }}
                                formatter={(val: any) => [`${val}g`, 'Dispensa']}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="actual" 
                                stroke="hsl(var(--primary))" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorActual)" 
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Grid 2 Columnas: Ranking Variedades + Top Socios */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Varieties Ranking */}
                <div className="bg-card p-6 rounded-2xl border border-border/80 shadow-xs">
                    <h3 className="font-bold text-lg mb-6 flex items-center gap-2 text-foreground">
                        <Leaf size={20} className="text-emerald-500" />
                        Variedades Dispensadas en el Periodo
                    </h3>
                    <div className="space-y-4">
                        {stats.varietyData.length > 0 ? (
                            stats.varietyData.map((item, idx) => (
                                <div key={item.name} className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-semibold text-foreground">{item.name}</span>
                                        <span className="text-muted-foreground font-bold">{item.value}g</span>
                                    </div>
                                    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                                        <div 
                                            className="h-2.5 bg-primary rounded-full transition-all duration-500" 
                                            style={{ 
                                                width: `${(item.value / stats.varietyData[0].value) * 100}%`,
                                                opacity: 1 - (idx * 0.12)
                                            }}
                                        ></div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-muted-foreground py-8 font-medium">Sin retiros registrados en este rango.</p>
                        )}
                    </div>
                </div>

                {/* Top Socios */}
                <div className="bg-card p-6 rounded-2xl border border-border/80 shadow-xs">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-foreground">
                            <Award size={20} className="text-amber-500" />
                            Top 10 Socios (Mayor Demanda)
                        </h3>
                        <button 
                            onClick={() => setShowSocioModal('active')}
                            className="text-xs text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer"
                        >
                            Ver todos <ChevronRight size={14} />
                        </button>
                    </div>
                    <div className="overflow-hidden border border-border rounded-xl">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="p-3 font-semibold">Socio</th>
                                    <th className="p-3 font-semibold">Retiros</th>
                                    <th className="p-3 font-semibold text-right">Total g</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {stats.topSocios.map((s, idx) => (
                                    <tr key={idx} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => router.push(`/admin/socios/${data.socios.find(soc => `${soc.nombre} ${soc.apellido}` === s.name)?.id}`)}>
                                        <td className="p-3 font-semibold text-foreground">{s.name}</td>
                                        <td className="p-3 text-muted-foreground font-medium">{s.orders}</td>
                                        <td className="p-3 text-right font-bold text-primary">{s.grams}g</td>
                                    </tr>
                                ))}
                                {stats.topSocios.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="p-8 text-center text-muted-foreground italic">No hay actividad registrada en el rango</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-6 pt-6 border-t border-border/60">
                        <div className="flex justify-between items-center p-3 bg-muted/30 rounded-xl">
                            <div>
                                <h4 className="text-sm font-bold text-foreground">Socios sin actividad</h4>
                                <p className="text-xs text-muted-foreground">No realizaron solicitudes en el periodo.</p>
                            </div>
                            <button 
                                onClick={() => setShowSocioModal('inactive')}
                                className="bg-background border border-border px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-muted transition-colors flex items-center gap-2 shadow-2xs cursor-pointer"
                            >
                                <Users size={14} />
                                Ver {stats.inactiveSocios.length} socios
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Alerts & Critical Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    <h3 className="font-bold text-lg text-foreground">Alertas de Gestión y Stock</h3>
                    <div className="grid grid-cols-1 gap-3">
                        {stats.alerts.length > 0 ? (
                            stats.alerts.map((alert, idx) => (
                                <div key={idx} className={`p-4 rounded-xl border flex gap-4 ${
                                    alert.type === 'critical' ? 'bg-red-500/10 border-red-500/30 text-red-900 dark:text-red-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-300'
                                }`}>
                                    <div className={`p-2.5 rounded-full h-fit ${alert.type === 'critical' ? 'bg-red-500/20 text-red-600' : 'bg-amber-500/20 text-amber-600'}`}>
                                        <AlertTriangle size={20} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm">{alert.title}</h4>
                                        <p className="text-xs sm:text-sm opacity-90 leading-relaxed mt-0.5">{alert.message}</p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="p-8 border-2 border-dashed border-border rounded-2xl text-center text-muted-foreground font-medium">
                                No hay alertas críticas en este momento. Stock y métricas en orden 🌱.
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-primary/5 border border-primary/20 p-6 rounded-2xl flex flex-col justify-center items-center text-center shadow-xs">
                    <h4 className="text-xs font-black text-primary uppercase tracking-widest mb-2">Ratio Sostenibilidad</h4>
                    <div className="text-4xl font-black text-primary mb-2">
                        {stats.totalGrams > 0 ? `$${(stats.totalAportes / stats.totalGrams).toFixed(0)}` : '$0'}
                    </div>
                    <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
                        Aporte promedio recibido por cada gramo dispensado en el período seleccionado.
                    </p>
                </div>
            </div>

            {/* Socio List Modal */}
            {showSocioModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-card w-full max-w-2xl max-h-[80vh] rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden text-foreground">
                        <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
                            <div>
                                <h3 className="text-xl font-bold">
                                    {showSocioModal === 'active' ? 'Socios con Retiros' : 'Socios sin Actividad'}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {showSocioModal === 'active' 
                                        ? `Total: ${stats.allActiveSocios.length} socios activos en este periodo.` 
                                        : `Total: ${stats.inactiveSocios.length} socios sin dispensas registradas.`}
                                </p>
                            </div>
                            <button onClick={() => setShowSocioModal(null)} className="p-2 hover:bg-muted rounded-full cursor-pointer">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="p-4 bg-muted/10 border-b border-border">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <input 
                                    type="text" 
                                    placeholder="Buscar por nombre o DNI..." 
                                    className="w-full pl-10 pr-4 py-2 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary outline-none text-sm"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-0">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/50 sticky top-0 text-muted-foreground text-xs uppercase tracking-wider">
                                    <tr>
                                        <th className="p-4 font-semibold">Socio</th>
                                        {showSocioModal === 'active' ? (
                                            <>
                                                <th className="p-4 font-semibold text-center">Pedidos</th>
                                                <th className="p-4 font-semibold text-right">Total Gramos</th>
                                            </>
                                        ) : (
                                            <>
                                                <th className="p-4 font-semibold">Última Solicitud</th>
                                                <th className="p-4 font-semibold text-right">Acción</th>
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {(showSocioModal === 'active' ? stats.allActiveSocios : stats.inactiveSocios)
                                        .filter((s: any) => s.name.toLowerCase().includes(searchTerm.toLowerCase()) || (s.dni && s.dni.toString().includes(searchTerm)))
                                        .map((s: any, idx) => (
                                            <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                                <td className="p-4">
                                                    <div className="font-bold text-foreground">{s.name}</div>
                                                    {s.dni && <div className="text-xs text-muted-foreground">DNI: {s.dni}</div>}
                                                </td>
                                                {showSocioModal === 'active' ? (
                                                    <>
                                                        <td className="p-4 text-center font-medium">{s.orders}</td>
                                                        <td className="p-4 text-right font-bold text-primary">{s.grams}g</td>
                                                    </>
                                                ) : (
                                                    <>
                                                        <td className="p-4 text-muted-foreground font-medium">
                                                            {s.lastOrder ? new Date(s.lastOrder).toLocaleDateString('es-AR') : 'Sin registros'}
                                                        </td>
                                                        <td className="p-4 text-right">
                                                            <button 
                                                                onClick={() => {
                                                                    setShowSocioModal(null);
                                                                    router.push(`/admin/socios/${s.id}`);
                                                                }}
                                                                className="text-primary hover:underline font-bold text-xs cursor-pointer"
                                                            >
                                                                Ver Perfil
                                                            </button>
                                                        </td>
                                                    </>
                                                )}
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-4 bg-muted/20 border-t border-border text-center">
                            <button onClick={() => setShowSocioModal(null)} className="px-6 py-2 bg-background border border-border rounded-xl font-bold hover:bg-muted transition-colors text-xs cursor-pointer shadow-xs">
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// --- COMPONENTE AVANZADO: COMPARATIVA ANUAL DE DISPENSA MENSUAL ---

function AnnualDispensationChart({ data }: { data: { pedidos: any[], productos: any[], pagos: any[], socios: any[] } }) {
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState<number>(currentYear);
    const [showYoY, setShowYoY] = useState<boolean>(true);
    const [metric, setMetric] = useState<'gramos' | 'aportes' | 'pedidos'>('gramos');
    const [showTable, setShowTable] = useState<boolean>(false);

    // Obtener años disponibles en la base de datos
    const availableYears = useMemo(() => {
        const yearsSet = new Set<number>();
        yearsSet.add(currentYear);
        yearsSet.add(currentYear - 1);

        data.pedidos.forEach(p => {
            const date = new Date(p.fechaRetiroPreferida || p.fechaCreacion);
            if (!isNaN(date.getTime())) {
                yearsSet.add(date.getFullYear());
            }
        });

        data.pagos.forEach(p => {
            const date = new Date(p.fecha);
            if (!isNaN(date.getTime())) {
                yearsSet.add(date.getFullYear());
            }
        });

        return Array.from(yearsSet).sort((a, b) => b - a);
    }, [data.pedidos, data.pagos, currentYear]);

    const compareYear = selectedYear - 1;

    const monthNamesShort = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const monthNamesFull = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    // Procesar los 12 meses para el año seleccionado y año comparativo
    const annualData = useMemo(() => {
        const months = Array.from({ length: 12 }, (_, i) => ({
            monthIndex: i,
            monthShort: monthNamesShort[i],
            monthFull: monthNamesFull[i],
            selectedVal: 0,
            compareVal: 0,
            selectedGrams: 0,
            compareGrams: 0,
            selectedAportes: 0,
            compareAportes: 0,
            selectedPedidos: 0,
            comparePedidos: 0,
            uniqueSociosSelected: new Set<string>(),
            uniqueSociosCompare: new Set<string>()
        }));

        // Pedidos completados
        const validPedidos = data.pedidos.filter(p => p.estado !== 'cancelado' && p.estado !== 'pendiente');

        validPedidos.forEach(p => {
            const d = new Date(p.fechaRetiroPreferida || p.fechaCreacion);
            if (isNaN(d.getTime())) return;

            const y = d.getFullYear();
            const m = d.getMonth();

            if (m < 0 || m > 11) return;

            const grams = p.items.reduce((sum: number, item: any) => {
                const prod = data.productos.find(pr => pr.id === item.productoId);
                return sum + (item.cantidad * (prod?.peso_gramos || 10));
            }, 0);

            if (y === selectedYear) {
                months[m].selectedGrams += grams;
                months[m].selectedPedidos += 1;
                if (p.socioId) months[m].uniqueSociosSelected.add(p.socioId);
            } else if (y === compareYear) {
                months[m].compareGrams += grams;
                months[m].comparePedidos += 1;
                if (p.socioId) months[m].uniqueSociosCompare.add(p.socioId);
            }
        });

        // Pagos / Aportes
        data.pagos.forEach(p => {
            const d = new Date(p.fecha);
            if (isNaN(d.getTime())) return;

            const y = d.getFullYear();
            const m = d.getMonth();
            if (m < 0 || m > 11) return;

            const monto = p.monto || 0;
            if (y === selectedYear) {
                months[m].selectedAportes += monto;
            } else if (y === compareYear) {
                months[m].compareAportes += monto;
            }
        });

        // Formatear según la métrica seleccionada
        return months.map(m => {
            let selVal = 0;
            let compVal = 0;

            if (metric === 'gramos') {
                selVal = m.selectedGrams;
                compVal = m.compareGrams;
            } else if (metric === 'aportes') {
                selVal = m.selectedAportes;
                compVal = m.compareAportes;
            } else {
                selVal = m.selectedPedidos;
                compVal = m.comparePedidos;
            }

            return {
                name: m.monthShort,
                monthFull: m.monthFull,
                valSelected: selVal,
                valCompare: compVal,
                gramosSelected: m.selectedGrams,
                gramosCompare: m.compareGrams,
                aportesSelected: m.selectedAportes,
                aportesCompare: m.compareAportes,
                pedidosSelected: m.selectedPedidos,
                pedidosCompare: m.comparePedidos,
                sociosCount: m.uniqueSociosSelected.size
            };
        });
    }, [data, selectedYear, compareYear, metric]);

    // Resumenes Anuales
    const totals = useMemo(() => {
        const totalSelected = annualData.reduce((acc, m) => acc + m.valSelected, 0);
        const totalCompare = annualData.reduce((acc, m) => acc + m.valCompare, 0);

        // Mes Pico
        let peakMonthObj = annualData[0];
        annualData.forEach(m => {
            if (m.valSelected > peakMonthObj.valSelected) {
                peakMonthObj = m;
            }
        });

        // Promedio mensual
        const currentMonthIdx = selectedYear === currentYear ? new Date().getMonth() + 1 : 12;
        const avgMonthly = totalSelected / Math.max(1, currentMonthIdx);

        // Crecimiento YoY %
        const yoyGrowth = totalCompare > 0 ? ((totalSelected - totalCompare) / totalCompare) * 100 : (totalSelected > 0 ? 100 : 0);

        return {
            totalSelected,
            totalCompare,
            avgMonthly,
            peakMonthName: peakMonthObj.valSelected > 0 ? peakMonthObj.monthFull : 'Sin datos',
            peakMonthVal: peakMonthObj.valSelected,
            yoyGrowth
        };
    }, [annualData, selectedYear, currentYear]);

    // Formateador de Tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || !payload.length) return null;

        const itemData = annualData.find(m => m.name === label);
        if (!itemData) return null;

        const valSel = itemData.valSelected;
        const valComp = itemData.valCompare;
        const diff = valSel - valComp;
        const diffPct = valComp > 0 ? ((diff / valComp) * 100).toFixed(1) : (valSel > 0 ? '+100' : '0');

        const unit = metric === 'gramos' ? 'g' : metric === 'aportes' ? '$' : ' dispensas';
        const isFormatMoney = metric === 'aportes';

        const formatVal = (v: number) => isFormatMoney ? `$${v.toLocaleString('es-AR')}` : `${v}${unit}`;

        return (
            <div className="bg-slate-950/90 backdrop-blur-md border border-slate-800 text-white p-4 rounded-2xl shadow-2xl text-xs space-y-2 max-w-xs animate-in fade-in">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-sm text-emerald-400">{itemData.monthFull} {selectedYear}</span>
                    {itemData.name === totals.peakMonthName.slice(0, 3) && totals.peakMonthVal > 0 && (
                        <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-black text-[10px] flex items-center gap-1 border border-amber-500/40">
                            ⭐️ Mes Pico
                        </span>
                    )}
                </div>
                
                <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between items-center">
                        <span className="text-slate-400 font-medium">{selectedYear}:</span>
                        <span className="font-bold text-emerald-400 text-sm">{formatVal(valSel)}</span>
                    </div>

                    {showYoY && (
                        <>
                            <div className="flex justify-between items-center text-slate-400">
                                <span>{compareYear}:</span>
                                <span className="font-medium text-slate-300">{formatVal(valComp)}</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-slate-800/60 font-bold">
                                <span>Variación YoY:</span>
                                <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                                    {diff >= 0 ? '+' : ''}{diffPct}%
                                </span>
                            </div>
                        </>
                    )}

                    {metric === 'gramos' && (
                        <div className="text-[10px] text-slate-400 pt-1 flex justify-between">
                            <span>Socios atendidos:</span>
                            <span className="text-slate-200 font-bold">{itemData.sociosCount}</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-card p-6 sm:p-8 rounded-3xl border border-border/80 shadow-md space-y-6 transition-all">
            {/* Header del Gráfico con Título y Filtros Aprobados */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-border/60 pb-6">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="p-2 bg-primary/10 rounded-xl text-primary">
                            <Sparkles size={20} />
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
                            Comparativa Anual de Dispensa Mensual
                        </h2>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                        Análisis comparativo de la demanda mensual de fitopreparados a lo largo de los 12 meses del año.
                    </p>
                </div>

                {/* Controles Estéticos (Métrica + Año + Modo Comparación) */}
                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                    {/* Selector de Métrica */}
                    <div className="bg-muted/60 p-1 rounded-xl flex items-center gap-1 border border-border/60">
                        <button
                            onClick={() => setMetric('gramos')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                metric === 'gramos' 
                                    ? 'bg-primary text-primary-foreground shadow-xs' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Gramos (g)
                        </button>
                        <button
                            onClick={() => setMetric('aportes')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                metric === 'aportes' 
                                    ? 'bg-primary text-primary-foreground shadow-xs' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Aportes ($)
                        </button>
                        <button
                            onClick={() => setMetric('pedidos')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                metric === 'pedidos' 
                                    ? 'bg-primary text-primary-foreground shadow-xs' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Dispensas (Cant)
                        </button>
                    </div>

                    {/* Selector de Año */}
                    <div className="flex items-center gap-2 bg-background border border-input rounded-xl px-3 py-1.5 shadow-2xs">
                        <Calendar size={15} className="text-muted-foreground" />
                        <select 
                            value={selectedYear} 
                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                            className="bg-transparent text-xs font-bold text-foreground outline-none cursor-pointer pr-1"
                        >
                            {availableYears.map(y => (
                                <option key={y} value={y} className="bg-card text-foreground font-semibold">{y}</option>
                            ))}
                        </select>
                    </div>

                    {/* Checkbox Comparación YoY */}
                    <button
                        onClick={() => setShowYoY(!showYoY)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                            showYoY 
                                ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-600 dark:text-indigo-400' 
                                : 'bg-background border-input text-muted-foreground hover:bg-muted'
                        }`}
                    >
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${showYoY ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-muted-foreground'}`}>
                            {showYoY && <Check size={10} strokeWidth={3} />}
                        </div>
                        Comparar con {compareYear}
                    </button>
                </div>
            </div>

            {/* Ribbon de Indicadores Anuales Clave (4 Cards de Resumen Anual) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-primary/5 border border-primary/15 rounded-2xl p-4 flex flex-col justify-between">
                    <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Total Anual ({selectedYear})</span>
                    <div className="text-xl sm:text-2xl font-black text-primary mt-1">
                        {metric === 'aportes' ? `$${totals.totalSelected.toLocaleString('es-AR')}` : `${totals.totalSelected}${metric === 'gramos' ? 'g' : ' u.'}`}
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium mt-1">Acumulado en los 12 meses</span>
                </div>

                <div className="bg-muted/40 border border-border/60 rounded-2xl p-4 flex flex-col justify-between">
                    <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Promedio Mensual</span>
                    <div className="text-xl sm:text-2xl font-black text-foreground mt-1">
                        {metric === 'aportes' ? `$${Math.round(totals.avgMonthly).toLocaleString('es-AR')}` : `${totals.avgMonthly.toFixed(1)}${metric === 'gramos' ? 'g' : ' u.'}`}
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium mt-1">Promedio por mes activo</span>
                </div>

                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400 tracking-wider">Mes Pico</span>
                        <Award size={14} className="text-amber-500" />
                    </div>
                    <div className="text-base sm:text-lg font-black text-foreground mt-1 truncate">
                        {totals.peakMonthName}
                    </div>
                    <span className="text-[10px] text-amber-700/80 dark:text-amber-400/80 font-bold mt-1">
                        {totals.peakMonthVal > 0 ? (metric === 'aportes' ? `$${totals.peakMonthVal.toLocaleString('es-AR')}` : `${totals.peakMonthVal}${metric === 'gramos' ? 'g' : ' u.'}`) : 'Sin registro'}
                    </span>
                </div>

                <div className="bg-muted/40 border border-border/60 rounded-2xl p-4 flex flex-col justify-between">
                    <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Crecimiento Anual (YoY)</span>
                    <div className={`text-xl sm:text-2xl font-black mt-1 flex items-center gap-1 ${totals.yoyGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {totals.yoyGrowth >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                        {Math.abs(totals.yoyGrowth).toFixed(1)}%
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium mt-1">Variación respecto a {compareYear}</span>
                </div>
            </div>

            {/* Gráfico Principal de Barras y Comparativa Anual */}
            <div className="pt-2">
                <div className="h-[340px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={annualData} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="selectedYearGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                                </linearGradient>
                                <linearGradient id="compareYearGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#818cf8" stopOpacity={0.8} />
                                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.4} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.6)" />
                            <XAxis 
                                dataKey="name" 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))', fontWeight: 600 }}
                                dy={10}
                            />
                            <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                                tickFormatter={(v) => metric === 'aportes' ? `$${(v/1000).toFixed(0)}k` : `${v}`}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            
                            {/* Barras de Año Seleccionado */}
                            <Bar 
                                dataKey="valSelected" 
                                name={`${selectedYear}`} 
                                fill="url(#selectedYearGrad)" 
                                radius={[6, 6, 0, 0]}
                                barSize={showYoY ? 18 : 26}
                            >
                                {annualData.map((entry, idx) => (
                                    <Cell 
                                        key={`cell-sel-${idx}`} 
                                        stroke={entry.monthFull === totals.peakMonthName && totals.peakMonthVal > 0 ? '#f59e0b' : 'transparent'} 
                                        strokeWidth={2}
                                    />
                                ))}
                            </Bar>

                            {/* Barras Comparativas de Año Anterior (si activo) */}
                            {showYoY && (
                                <Bar 
                                    dataKey="valCompare" 
                                    name={`${compareYear}`} 
                                    fill="url(#compareYearGrad)" 
                                    radius={[6, 6, 0, 0]}
                                    barSize={18}
                                />
                            )}

                            {/* Línea de Tendencia del Año Seleccionado */}
                            <Line 
                                type="monotone" 
                                dataKey="valSelected" 
                                stroke="hsl(var(--primary))" 
                                strokeWidth={2.5}
                                dot={{ r: 3.5, fill: 'hsl(var(--primary))', strokeWidth: 2, stroke: 'hsl(var(--card))' }}
                                activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Leyenda y Botón para desplegar Tabla de Detalle Mensual */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-border/60">
                <div className="flex items-center gap-6 text-xs font-semibold">
                    <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-md bg-primary shadow-2xs"></span>
                        <span className="text-foreground">{selectedYear} ({metric === 'gramos' ? 'Gramos' : metric === 'aportes' ? 'Aportes' : 'Dispensas'})</span>
                    </div>
                    {showYoY && (
                        <div className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 rounded-md bg-indigo-500 shadow-2xs"></span>
                            <span className="text-muted-foreground">{compareYear} (Comparativo)</span>
                        </div>
                    )}
                </div>

                <button
                    onClick={() => setShowTable(!showTable)}
                    className="text-xs font-bold text-primary hover:underline flex items-center gap-1.5 cursor-pointer self-end sm:self-auto"
                >
                    <TableIcon size={14} />
                    {showTable ? 'Ocultar tabla de detalle' : 'Ver desglose mes a mes (Tabla)'}
                    {showTable ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
            </div>

            {/* Tabla Colapsable de Detalle Mensual */}
            {showTable && (
                <div className="overflow-hidden border border-border rounded-2xl animate-in zoom-in-95 duration-200 mt-4">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-muted/60 text-muted-foreground uppercase font-black tracking-wider text-[10px]">
                            <tr>
                                <th className="p-3">Mes</th>
                                <th className="p-3 text-right">Dispensa ({selectedYear})</th>
                                {showYoY && <th className="p-3 text-right">Dispensa ({compareYear})</th>}
                                <th className="p-3 text-right">Aportes ({selectedYear})</th>
                                <th className="p-3 text-right">Dispensas (Cant)</th>
                                {showYoY && <th className="p-3 text-right">Variación YoY</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                            {annualData.map((m, idx) => {
                                const diffGrams = m.gramosSelected - m.gramosCompare;
                                const pctGrowth = m.gramosCompare > 0 ? ((diffGrams / m.gramosCompare) * 100).toFixed(1) : (m.gramosSelected > 0 ? '+100' : '0');
                                const isPeak = m.monthFull === totals.peakMonthName && totals.peakMonthVal > 0;

                                return (
                                    <tr key={idx} className={`hover:bg-muted/30 transition-colors ${isPeak ? 'bg-amber-500/5 font-semibold' : ''}`}>
                                        <td className="p-3 font-bold text-foreground flex items-center gap-2">
                                            {m.monthFull}
                                            {isPeak && <span className="text-[10px] text-amber-600 bg-amber-500/20 px-1.5 py-0.2 rounded font-black">PICO</span>}
                                        </td>
                                        <td className="p-3 text-right font-bold text-primary">{m.gramosSelected}g</td>
                                        {showYoY && <td className="p-3 text-right text-muted-foreground">{m.gramosCompare}g</td>}
                                        <td className="p-3 text-right font-semibold text-foreground">${m.aportesSelected.toLocaleString('es-AR')}</td>
                                        <td className="p-3 text-right text-muted-foreground font-medium">{m.pedidosSelected} u.</td>
                                        {showYoY && (
                                            <td className={`p-3 text-right font-bold ${diffGrams >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {diffGrams >= 0 ? '+' : ''}{pctGrowth}%
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function StatCard({ title, value, icon: Icon, variation, subtext }: { title: string, value: string, icon: any, variation: number, subtext: string }) {
    const isPositive = variation >= 0;
    
    return (
        <div className="bg-card p-6 rounded-2xl border border-border/80 shadow-xs hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                    <Icon size={20} />
                </div>
                {variation !== 0 && (
                    <div className={`flex items-center gap-0.5 text-xs font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        {Math.abs(variation).toFixed(1)}%
                    </div>
                )}
            </div>
            <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{title}</p>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">{value}</h2>
                <p className="text-[10px] text-muted-foreground mt-2 uppercase font-black tracking-wider">{subtext}</p>
            </div>
        </div>
    );
}
