"use client";

import React, { useEffect, useState } from 'react';
import { StoreService } from '@/services/storeService';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { 
    Calendar as CalendarIcon, 
    Clock, 
    Plus, 
    Trash2, 
    CheckCircle2, 
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    CalendarCheck,
    MousePointer2
} from 'lucide-react';

export default function AgendaAdminPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [slots, setSlots] = useState<any[]>([]);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Form State
    const [selectedDates, setSelectedDates] = useState<string[]>([]);
    const [startTime, setStartTime] = useState('14:00');
    const [endTime, setEndTime] = useState('18:00');
    const [interval, setInterval] = useState(20); // 20 min slots

    // Calendar UI State
    const [currentMonth, setCurrentMonth] = useState(new Date());

    useEffect(() => {
        if (!authLoading) {
            if (!user || (user.rol !== 'admin' && user.rol !== 'staff')) {
                router.push('/');
                return;
            }
            fetchSlots();
        }
    }, [user, authLoading]);

    const fetchSlots = async () => {
        setLoading(true);
        try {
            const data = await StoreService.getSlots(new Date().toISOString().split('T')[0]);
            setSlots(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const toggleDate = (dateStr: string) => {
        setSelectedDates(prev => 
            prev.includes(dateStr) 
                ? prev.filter(d => d !== dateStr) 
                : [...prev, dateStr]
        );
    };

    const handleGenerate = async () => {
        if (selectedDates.length === 0) {
            alert("Selecciona al menos un día en el calendario.");
            return;
        }
        
        setGenerating(true);
        setMessage(null);
        try {
            await StoreService.createMassiveSlots(selectedDates, startTime, endTime, interval);
            setMessage({ type: 'success', text: `¡Agenda generada! Se crearon los turnos para ${selectedDates.length} días.` });
            setSelectedDates([]);
            fetchSlots();
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: 'Error al generar los turnos. Verifica los horarios.' });
        } finally {
            setGenerating(false);
        }
    };

    const handleDeleteSlot = async (id: string) => {
        if (!confirm('¿Seguro quieres eliminar este turno?')) return;
        try {
            await StoreService.deleteSlot(id);
            setSlots(prev => prev.filter(s => s.id !== id));
        } catch (e) {
            alert('Error al eliminar');
        }
    };

    // Calendar Helpers
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const renderCalendar = () => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const daysInMonth = getDaysInMonth(year, month);
        const firstDay = getFirstDayOfMonth(year, month);
        
        const days = [];
        // Adjusted for Monday start if desired, but 0=Sun is default
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="h-12 w-full"></div>);
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const dateStr = date.toISOString().split('T')[0];
            const isSelected = selectedDates.includes(dateStr);
            const isPast = date < new Date(new Date().setHours(0,0,0,0));
            const hasSlots = slots.some(s => s.date === dateStr);

            days.push(
                <button
                    key={d}
                    disabled={isPast}
                    onClick={() => toggleDate(dateStr)}
                    className={`
                        h-12 w-full rounded-xl flex flex-col items-center justify-center relative transition-all
                        ${isPast ? 'opacity-20 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}
                        ${isSelected ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 z-10' : 'bg-muted/50 hover:bg-muted'}
                    `}
                >
                    <span className="text-sm font-bold">{d}</span>
                    {hasSlots && !isSelected && (
                        <div className="absolute bottom-1 w-1 h-1 bg-primary rounded-full"></div>
                    )}
                </button>
            );
        }

        return days;
    };

    if (authLoading || loading) return <div className="p-12 text-center">Cargando agenda...</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Gestión de Agenda</h1>
                    <p className="text-muted-foreground">Define tu disponibilidad para retiros en sede de forma ágil.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Quick Loader */}
                <div className="lg:col-span-7 space-y-6">
                    <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-6">
                        <div className="flex items-center gap-2 font-bold text-lg mb-2">
                            <MousePointer2 className="text-primary" size={20} />
                            1. Selecciona los días
                        </div>
                        
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="font-bold capitalize">
                                    {currentMonth.toLocaleString('es-AR', { month: 'long', year: 'numeric' })}
                                </h3>
                                <div className="flex gap-1">
                                    <button 
                                        onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))}
                                        className="p-1.5 hover:bg-muted rounded-lg"
                                    >
                                        <ChevronLeft size={20} />
                                    </button>
                                    <button 
                                        onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))}
                                        className="p-1.5 hover:bg-muted rounded-lg"
                                    >
                                        <ChevronRight size={20} />
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-7 gap-2 text-center mb-2">
                                {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => (
                                    <div key={d} className="text-[10px] font-black text-muted-foreground uppercase">{d}</div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7 gap-2">
                                {renderCalendar()}
                            </div>
                            
                            {selectedDates.length > 0 && (
                                <div className="bg-primary/5 p-3 rounded-lg border border-primary/10 flex justify-between items-center">
                                    <span className="text-sm font-medium text-primary">
                                        {selectedDates.length} días seleccionados
                                    </span>
                                    <button onClick={() => setSelectedDates([])} className="text-xs font-bold hover:underline">Limpiar</button>
                                </div>
                            )}
                        </div>

                        <div className="pt-6 border-t border-dashed space-y-6">
                            <div className="flex items-center gap-2 font-bold text-lg">
                                <Clock className="text-primary" size={20} />
                                2. Configura el horario
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label className="text-xs font-bold uppercase text-muted-foreground mb-1 block">Desde</label>
                                    <input 
                                        type="time" 
                                        value={startTime}
                                        onChange={e => setStartTime(e.target.value)}
                                        className="w-full p-2.5 rounded-lg border bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold uppercase text-muted-foreground mb-1 block">Hasta</label>
                                    <input 
                                        type="time" 
                                        value={endTime}
                                        onChange={e => setEndTime(e.target.value)}
                                        className="w-full p-2.5 rounded-lg border bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold uppercase text-muted-foreground mb-1 block">Cada (min)</label>
                                    <select 
                                        value={interval}
                                        onChange={e => setInterval(Number(e.target.value))}
                                        className="w-full p-2.5 rounded-lg border bg-background"
                                    >
                                        <option value={15}>15 min</option>
                                        <option value={20}>20 min</option>
                                        <option value={30}>30 min</option>
                                        <option value={60}>1 hora</option>
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={handleGenerate}
                                disabled={generating || selectedDates.length === 0}
                                className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {generating ? <RefreshCw className="animate-spin" /> : <CalendarCheck size={20} />}
                                Generar Agenda para {selectedDates.length} días
                            </button>

                            {message && (
                                <div className={`p-4 rounded-xl flex items-center gap-3 border ${
                                    message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
                                }`}>
                                    {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                                    <p className="text-sm font-medium">{message.text}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Existing Slots */}
                <div className="lg:col-span-5 space-y-6">
                    <div className="bg-card rounded-2xl border shadow-sm flex flex-col h-[700px]">
                        <div className="p-6 border-b flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2">
                                <CalendarIcon size={18} className="text-primary" />
                                Próximos Turnos
                            </h3>
                            <span className="text-xs bg-muted px-2 py-1 rounded-full font-bold">{slots.length} totales</span>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {slots.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                                    <CalendarIcon size={48} className="mb-4" />
                                    <p className="text-sm">No hay turnos programados a futuro.</p>
                                </div>
                            ) : (
                                // Group slots by date for better UI
                                Object.entries(
                                    slots.reduce((acc: any, slot) => {
                                        if (!acc[slot.date]) acc[slot.date] = [];
                                        acc[slot.date].push(slot);
                                        return acc;
                                    }, {})
                                ).map(([date, dateSlots]: [string, any]) => (
                                    <div key={date} className="space-y-2">
                                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-2">
                                            {new Date(date + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {dateSlots.map((slot: any) => (
                                                <div key={slot.id} className="bg-muted/40 p-2 rounded-lg border border-border/50 flex justify-between items-center group">
                                                    <span className="text-xs font-bold">{slot.start_time} - {slot.end_time}</span>
                                                    <button 
                                                        onClick={() => handleDeleteSlot(slot.id)}
                                                        className="text-destructive opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const RefreshCw = ({ className }: { className?: string }) => (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
);
