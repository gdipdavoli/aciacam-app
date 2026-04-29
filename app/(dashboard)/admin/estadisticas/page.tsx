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
    ArrowDownRight
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
    Legend
} from 'recharts';

export default function EstadisticasPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<{
        pedidos: any[],
        socios: any[],
        productos: any[],
        pagos: any[]
    }>({ pedidos: [], socios: [], productos: [], pagos: [] });

    // Rango de fechas (por defecto mes actual)
    const [dateRange, setDateRange] = useState({
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }
            fetchStats();
        }
    }, [user, authLoading]);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const res = await StoreService.getStatsData();
            setData(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // --- LÓGICA DE CÁLCULOS ---

    const stats = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
        const lastMonth = lastMonthDate.getMonth();
        const lastMonthYear = lastMonthDate.getFullYear();

        // Filtrar pedidos del mes actual y anterior (excluyendo cancelados para gramos)
        const filterByMonth = (items: any[], month: number, year: number) => {
            return items.filter(item => {
                const d = new Date(item.fechaCreacion || item.fecha);
                return d.getMonth() === month && d.getFullYear() === year;
            });
        };

        const currentMonthPedidos = filterByMonth(data.pedidos, currentMonth, currentYear).filter(p => p.estado !== 'cancelado');
        const lastMonthPedidos = filterByMonth(data.pedidos, lastMonth, lastMonthYear).filter(p => p.estado !== 'cancelado');
        
        const currentMonthPagos = filterByMonth(data.pagos, currentMonth, currentYear);
        const lastMonthPagos = filterByMonth(data.pagos, lastMonth, lastMonthYear);

        // Cálculos de Gramos
        const getGrams = (pedidos: any[]) => {
            return pedidos.reduce((acc, p) => {
                const pGrams = p.items.reduce((sum: number, item: any) => {
                    // Buscar peso en productos si no está denormalizado
                    const prod = data.productos.find(pr => pr.id === item.productoId);
                    return sum + (item.cantidad * (prod?.peso_gramos || 10));
                }, 0);
                return acc + pGrams;
            }, 0);
        };

        const totalGrams = getGrams(currentMonthPedidos);
        const prevTotalGrams = getGrams(lastMonthPedidos);
        
        // Socios que retiraron
        const currentSociosCount = new Set(currentMonthPedidos.map(p => p.socioId)).size;
        const lastSociosCount = new Set(lastMonthPedidos.map(p => p.socioId)).size;

        // Aportes
        const totalAportes = currentMonthPagos.reduce((acc, p) => acc + (p.monto || 0), 0);
        const prevTotalAportes = lastMonthPagos.reduce((acc, p) => acc + (p.monto || 0), 0);

        // Variaciones
        const getVariation = (curr: number, prev: number) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return ((curr - prev) / prev) * 100;
        };

        // Datos para gráfico de línea (Días del mes)
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const chartData = Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dayGrams = currentMonthPedidos
                .filter(p => new Date(p.fechaCreacion).getDate() === day)
                .reduce((acc, p) => {
                    return acc + p.items.reduce((sum: number, item: any) => {
                        const prod = data.productos.find(pr => pr.id === item.productoId);
                        return sum + (item.cantidad * (prod?.peso_gramos || 10));
                    }, 0);
                }, 0);
            
            const prevDayGrams = lastMonthPedidos
                .filter(p => new Date(p.fechaCreacion).getDate() === day)
                .reduce((acc, p) => {
                    return acc + p.items.reduce((sum: number, item: any) => {
                        const prod = data.productos.find(pr => pr.id === item.productoId);
                        return sum + (item.cantidad * (prod?.peso_gramos || 10));
                    }, 0);
                }, 0);

            return {
                name: day.toString(),
                actual: dayGrams,
                anterior: prevDayGrams
            };
        });

        // Variedades dispensadas
        const varietyMap: Record<string, number> = {};
        currentMonthPedidos.forEach(p => {
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
        const socioStatsMap: Record<string, { name: string, grams: number, orders: number }> = {};
        currentMonthPedidos.forEach(p => {
            const socio = data.socios.find(s => s.id === p.socioId);
            const name = socio ? `${socio.nombre} ${socio.apellido}` : 'Desconocido';
            const g = p.items.reduce((sum: number, item: any) => {
                const prod = data.productos.find(pr => pr.id === item.productoId);
                return sum + (item.cantidad * (prod?.peso_gramos || 10));
            }, 0);

            if (!socioStatsMap[p.socioId]) {
                socioStatsMap[p.socioId] = { name, grams: 0, orders: 0 };
            }
            socioStatsMap[p.socioId].grams += g;
            socioStatsMap[p.socioId].orders += 1;
        });

        const topSocios = Object.values(socioStatsMap)
            .sort((a, b) => b.grams - a.grams)
            .slice(0, 10);

        // Alertas
        const alerts = [];
        // Stock bajo (umbral 20 unidades/gramos arbitrario para demo)
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
            alerts
        };
    }, [data]);

    if (loading || authLoading) return <div className="p-8 text-center">Analizando datos...</div>;

    return (
        <div className="space-y-8 pb-12">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Panel de Estadísticas</h1>
                    <p className="text-muted-foreground">Monitoreo de dispensación y sostenibilidad.</p>
                </div>
                <div className="flex gap-2">
                    <button className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                        <Calendar size={16} />
                        Mes Actual
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                        <Download size={16} />
                        Exportar Reporte
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
                    subtext="vs mes anterior" 
                />
                <StatCard 
                    title="Socios Activos" 
                    value={stats.currentSociosCount.toString()} 
                    icon={Users} 
                    variation={stats.sociosVariation} 
                    subtext="con retiros este mes" 
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

            {/* Main Chart */}
            <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <TrendingUp size={20} className="text-primary" />
                        Demanda Mensual (Gramos)
                    </h3>
                    <div className="flex items-center gap-4 text-xs font-medium">
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-primary"></span> Mes Actual
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-muted-foreground/30"></span> Mes Anterior
                        </div>
                    </div>
                </div>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats.chartData}>
                            <defs>
                                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
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
                                    borderRadius: '8px',
                                    fontSize: '12px'
                                }}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="actual" 
                                stroke="hsl(var(--primary))" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorActual)" 
                            />
                            <Line 
                                type="monotone" 
                                dataKey="anterior" 
                                stroke="hsl(var(--muted-foreground))" 
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                dot={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Varieties Ranking */}
                <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
                    <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                        Variedades Dispensadas
                    </h3>
                    <div className="space-y-4">
                        {stats.varietyData.length > 0 ? (
                            stats.varietyData.map((item, idx) => (
                                <div key={item.name} className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-medium">{item.name}</span>
                                        <span className="text-muted-foreground">{item.value}g</span>
                                    </div>
                                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                                        <div 
                                            className="h-2 bg-primary rounded-full" 
                                            style={{ 
                                                width: `${(item.value / stats.varietyData[0].value) * 100}%`,
                                                opacity: 1 - (idx * 0.15)
                                            }}
                                        ></div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-muted-foreground py-8">Sin datos este mes</p>
                        )}
                    </div>
                </div>

                {/* Top Socios */}
                <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
                    <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                        Top 10 Socios (Demanda)
                    </h3>
                    <div className="overflow-hidden border rounded-lg">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground">
                                <tr>
                                    <th className="p-3 font-medium">Socio</th>
                                    <th className="p-3 font-medium">Retiros</th>
                                    <th className="p-3 font-medium text-right">Total g</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {stats.topSocios.map((s, idx) => (
                                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                        <td className="p-3 font-medium">{s.name}</td>
                                        <td className="p-3 text-muted-foreground">{s.orders}</td>
                                        <td className="p-3 text-right font-bold text-primary">{s.grams}g</td>
                                    </tr>
                                ))}
                                {stats.topSocios.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="p-8 text-center text-muted-foreground">No hay actividad registrada</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Alerts & Critical Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    <h3 className="font-bold text-lg">Alertas de Gestión</h3>
                    <div className="grid grid-cols-1 gap-3">
                        {stats.alerts.length > 0 ? (
                            stats.alerts.map((alert, idx) => (
                                <div key={idx} className={`p-4 rounded-lg border flex gap-4 ${
                                    alert.type === 'critical' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                                }`}>
                                    <div className={`p-2 rounded-full h-fit ${alert.type === 'critical' ? 'bg-red-100' : 'bg-amber-100'}`}>
                                        <AlertTriangle size={20} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm">{alert.title}</h4>
                                        <p className="text-sm opacity-90">{alert.message}</p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="p-8 border-2 border-dashed rounded-lg text-center text-muted-foreground">
                                No hay alertas críticas en este momento.
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-primary/5 border border-primary/20 p-6 rounded-xl flex flex-col justify-center items-center text-center">
                    <h4 className="text-sm font-bold text-primary uppercase tracking-widest mb-2">Ratio Sostenibilidad</h4>
                    <div className="text-4xl font-black text-primary mb-2">
                        {stats.totalGrams > 0 ? `$${(stats.totalAportes / stats.totalGrams).toFixed(0)}` : '$0'}
                    </div>
                    <p className="text-xs text-muted-foreground max-w-[200px]">
                        Aporte promedio recibido por cada gramo dispensado este mes.
                    </p>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon: Icon, variation, subtext }: { title: string, value: string, icon: any, variation: number, subtext: string }) {
    const isPositive = variation >= 0;
    
    return (
        <div className="bg-card p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
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
                <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
                <h2 className="text-2xl font-bold tracking-tight">{value}</h2>
                <p className="text-[10px] text-muted-foreground mt-2 uppercase font-bold tracking-wider">{subtext}</p>
            </div>
        </div>
    );
}
