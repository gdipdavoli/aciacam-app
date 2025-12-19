
"use client";

import React, { useEffect, useState } from 'react';
import { Trash2, Plus, Calendar, Save, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

type ConfigRule = {
    id?: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    capacity: number;
    active: boolean;
};

type Slot = {
    id: string;
    start_time: string;
    end_time: string;
    capacity: number;
    status: string;
};

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function AgendaManager() {
    const { session } = useAuth(); // Get session
    const [configs, setConfigs] = useState<ConfigRule[]>([]);
    const [slots, setSlots] = useState<Slot[]>([]);
    const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [isGenerating, setIsGenerating] = useState(false);

    // Form State
    const [showForm, setShowForm] = useState(false);

    // Form Inputs
    const [selectedDays, setSelectedDays] = useState<number[]>([1]); // Default Monday
    const [startTime, setStartTime] = useState('10:00');
    const [endTime, setEndTime] = useState('18:00');
    // Use string for capacity to handle empty/backspace correctly
    const [capacityStr, setCapacityStr] = useState('5');

    useEffect(() => {
        if (session?.access_token) {
            fetchConfigs();
            fetchSlots();
        }
    }, [month, session]); // Add session dependency

    const getHeaders = () => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
    });

    const fetchConfigs = async () => {
        try {
            const res = await fetch('/api/agenda', { headers: getHeaders() });
            const data = await res.json();
            if (data.configs) setConfigs(data.configs);
        } catch (e) {
            console.error("Error fetching configs", e);
        } finally {
            setLoading(false);
        }
    };

    const fetchSlots = async () => {
        try {
            const res = await fetch(`/api/agenda?action=get_slots&month=${month}`, { headers: getHeaders() });
            const data = await res.json();
            if (data.slots) setSlots(data.slots);
        } catch (e) {
            console.error("Error fetching slots", e);
        }
    };

    const toggleDay = (dayIndex: number) => {
        if (selectedDays.includes(dayIndex)) {
            setSelectedDays(selectedDays.filter(d => d !== dayIndex));
        } else {
            setSelectedDays([...selectedDays, dayIndex].sort());
        }
    };

    const handleSaveRule = async () => {
        if (selectedDays.length === 0) {
            alert("Por favor seleccione al menos un día.");
            return;
        }

        const cap = parseInt(capacityStr);
        if (isNaN(cap) || cap < 1) {
            alert("La capacidad debe ser un número mayor a 0.");
            return;
        }

        try {
            // Save one rule per selected day
            const promises = selectedDays.map(day =>
                fetch('/api/agenda', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({
                        action: 'UPSERT_RULE',
                        data: {
                            day_of_week: day,
                            start_time: startTime,
                            end_time: endTime,
                            capacity: cap,
                            active: true
                        }
                    })
                })
            );

            await Promise.all(promises);

            setShowForm(false);
            // Reset form defaults if needed, or keep for quick add
            fetchConfigs();
        } catch (e) {
            console.error(e);
            alert("Error al guardar reglas");
        }
    };

    const handleDeleteRule = async (id: string) => {
        if (!confirm('¿Eliminar esta regla recurrente?')) return;
        try {
            const res = await fetch(`/api/agenda?id=${id}&type=rule`, {
                method: 'DELETE',
                headers: getHeaders()
            });
            if (res.ok) fetchConfigs();
        } catch (e) {
            console.error(e);
        }
    };

    const handleGenerate = async () => {
        if (!confirm(`¿Generar turnos para ${month} basados en las reglas actuales?`)) return;
        setIsGenerating(true);
        try {
            const res = await fetch('/api/agenda', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ action: 'GENERATE', month })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Generados ${data.count} turnos.`);
                fetchSlots();
            } else {
                alert('Error generando turnos: ' + data.error);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDeleteSlot = async (id: string) => {
        if (!confirm('¿Eliminar este turno específico?')) return;
        try {
            await fetch(`/api/agenda?id=${id}&type=slot`, {
                method: 'DELETE',
                headers: getHeaders()
            });
            fetchSlots(); // Refresh list
        } catch (e) { console.error(e); }
    };

    const toggleSlotSelection = (id: string) => {
        const newSelected = new Set(selectedSlotIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedSlotIds(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedSlotIds.size === slots.length) {
            setSelectedSlotIds(new Set());
        } else {
            setSelectedSlotIds(new Set(slots.map(s => s.id)));
        }
    };

    const handleBulkDelete = async () => {
        const count = selectedSlotIds.size;
        if (count === 0) return;
        if (!confirm(`¿Estás seguro de que deseas eliminar ${count} turnos seleccionados?`)) return;

        setLoading(true);
        try {
            // Execute deletions in parallel batches to avoid browser hanging but speed up
            const idsToDelete = Array.from(selectedSlotIds);
            const batchSize = 5;

            for (let i = 0; i < idsToDelete.length; i += batchSize) {
                const batch = idsToDelete.slice(i, i + batchSize);
                await Promise.all(batch.map(id =>
                    fetch(`/api/agenda?id=${id}&type=slot`, {
                        method: 'DELETE',
                        headers: getHeaders()
                    })
                ));
            }

            setSelectedSlotIds(new Set());
            fetchSlots();
        } catch (e) {
            console.error(e);
            alert("Ocurrió un error al eliminar algunos turnos.");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAllVisible = () => {
        if (slots.length === 0) return;
        // Select all then trigger delete
        setSelectedSlotIds(new Set(slots.map(s => s.id)));
        // We defer the actual delete call to the user clicking the delete button or we could prompt immediately
        // But better UX is: user clicks "Select All", then "Delete".
        // If user wants "Delete Agenda Completa", maybe strictly imply deleting all visible.
        if (confirm(`¿ATENCIÓN: Esto eliminará TODOS los ${slots.length} turnos visibles de este mes. ¿Continuar?`)) {
            // Hack: set state then call delete? State updates are async.
            // Better: pass all IDs explicitly to a helper
            performBulkDelete(slots.map(s => s.id));
        }
    };

    const performBulkDelete = async (ids: string[]) => {
        setLoading(true);
        try {
            const batchSize = 10;
            for (let i = 0; i < ids.length; i += batchSize) {
                const batch = ids.slice(i, i + batchSize);
                await Promise.all(batch.map(id =>
                    fetch(`/api/agenda?id=${id}&type=slot`, { // Using singular delete endpoint reuse
                        method: 'DELETE',
                        headers: getHeaders()
                    })
                ));
            }
            setSelectedSlotIds(new Set());
            fetchSlots();
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };


    if (loading) return <div>Cargando configuración...</div>;

    return (
        <div className="space-y-8">

            {/* Rules Section */}
            {/* Rules Section */}
            <section className="bg-card p-6 rounded-lg shadow-sm border border-border">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Calendar size={24} /> Reglas Recurrentes
                    </h2>
                    <button
                        onClick={() => setShowForm(true)}
                        className="bg-primary text-primary-foreground px-4 py-2 rounded-md flex items-center gap-2 text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        <Plus size={16} /> Nueva Regla
                    </button>
                </div>

                {showForm && (
                    <div className="bg-muted/30 p-4 rounded-md mb-4 border border-border animate-in fade-in zoom-in duration-200">
                        <h3 className="font-semibold mb-3">Definir Nueva Regla de Retiro</h3>

                        <div className="mb-4">
                            <label className="block text-xs uppercase text-muted-foreground font-bold mb-2">Días</label>
                            <div className="flex flex-wrap gap-2">
                                {DAYS.map((d, i) => (
                                    <button
                                        key={i}
                                        onClick={() => toggleDay(i)}
                                        className={`
                                            px-3 py-1 text-sm rounded-full border transition-colors
                                            ${selectedDays.includes(i)
                                                ? 'bg-primary text-primary-foreground border-primary'
                                                : 'bg-background text-muted-foreground border-input hover:border-primary/50'
                                            }
                                        `}
                                    >
                                        {d.slice(0, 3)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                            <div>
                                <label className="block text-xs uppercase text-muted-foreground font-bold mb-1">Inicio</label>
                                <input
                                    type="time"
                                    className="w-full p-2 border rounded bg-background text-foreground border-input"
                                    value={startTime}
                                    onChange={e => setStartTime(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs uppercase text-muted-foreground font-bold mb-1">Fin</label>
                                <input
                                    type="time"
                                    className="w-full p-2 border rounded bg-background text-foreground border-input"
                                    value={endTime}
                                    onChange={e => setEndTime(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs uppercase text-muted-foreground font-bold mb-1">Cupos</label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded bg-background text-foreground border-input"
                                    value={capacityStr}
                                    onChange={e => setCapacityStr(e.target.value)}
                                    min={1}
                                />
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleSaveRule} className="flex-1 bg-green-600 text-white p-2 rounded hover:bg-green-700 flex justify-center items-center gap-1">
                                    <Save size={16} /> Guardar
                                </button>
                                <button onClick={() => setShowForm(false)} className="bg-secondary text-secondary-foreground p-2 rounded hover:bg-secondary/80">
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-muted/50 border-b border-border">
                                <th className="text-left p-3">Día</th>
                                <th className="text-left p-3">Horario</th>
                                <th className="text-left p-3">Capacidad</th>
                                <th className="text-right p-3">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {configs.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="p-4 text-center text-muted-foreground">No hay reglas configuradas.</td>
                                </tr>
                            ) : (
                                configs.map(c => (
                                    <tr key={c.id} className="border-b hover:bg-muted/50 border-border">
                                        <td className="p-3 font-medium text-foreground">{DAYS[c.day_of_week]}</td>
                                        <td className="p-3">{c.start_time.slice(0, 5)} - {c.end_time.slice(0, 5)}</td>
                                        <td className="p-3 badge"><span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-bold">{c.capacity} pers.</span></td>
                                        <td className="p-3 text-right">
                                            <button
                                                onClick={() => handleDeleteRule(c.id!)}
                                                className="text-destructive hover:text-destructive p-1 hover:bg-destructive/10 rounded"
                                                title="Eliminar regla"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Generation Section */}
            <section className="bg-card p-6 rounded-lg shadow-sm border border-border">
                <div className="flex justify-between items-end mb-6 border-b pb-4">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            Generación de Turnos
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">Selecciona un mes para ver o generar turnos disponibles.</p>
                    </div>

                    <div className="flex items-center gap-4">
                        <input
                            type="month"
                            value={month}
                            onChange={e => setMonth(e.target.value)}
                            className="p-2 border rounded text-lg font-medium bg-background text-foreground border-input"
                        />
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating || configs.length === 0}
                            className={`
                                px-4 py-2 rounded-md font-medium text-white transition-colors
                                ${configs.length === 0 ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary hover:bg-emerald-600'}
                                ${isGenerating ? 'opacity-75 cursor-wait' : ''}
                            `}
                        >
                            {isGenerating ? 'Generando...' : 'Generar Turnos'}
                        </button>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                        Turnos Activos ({slots.length})
                    </h3>

                    {slots.length === 0 ? (
                        <div className="p-8 text-center bg-muted/20 border border-dashed border-border rounded-lg text-muted-foreground">
                            No hay turnos generados para este mes aún.
                        </div>
                    ) : (
                        <div>
                            <div className="flex justify-between items-center mb-4 bg-muted/40 p-2 rounded border border-border">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                                        checked={selectedSlotIds.size === slots.length && slots.length > 0}
                                        onChange={handleSelectAll}
                                        id="select-all-slots"
                                    />
                                    <label htmlFor="select-all-slots" className="text-sm font-medium text-foreground cursor-pointer select-none">
                                        Seleccionar Todo ({slots.length})
                                    </label>
                                </div>

                                {selectedSlotIds.size > 0 && (
                                    <button
                                        onClick={handleBulkDelete}
                                        className="flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-1.5 rounded-md text-sm font-medium hover:bg-destructive/20 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                        Eliminar Seleccionados ({selectedSlotIds.size})
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {slots.map(slot => {
                                    const date = new Date(slot.start_time);
                                    const dateStr = date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
                                    const timeStr = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                                    const isSelected = selectedSlotIds.has(slot.id);

                                    return (
                                        <div
                                            key={slot.id}
                                            className={`
                                                border p-2 rounded text-sm relative group cursor-pointer transition-all
                                                ${isSelected ? 'bg-primary/10 border-primary ring-1 ring-primary' : 'bg-muted/10 border-border hover:border-foreground/30'}
                                            `}
                                            onClick={(e) => {
                                                // Prevent toggling if clicking specific action buttons if any
                                                toggleSlotSelection(slot.id);
                                            }}
                                        >
                                            <div className="absolute top-2 right-2">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => { }} // Handled by div click
                                                    className="w-4 h-4 rounded border-input text-primary focus:ring-primary pointer-events-none"
                                                />
                                            </div>

                                            <div className="font-bold text-foreground">{dateStr}</div>
                                            <div className="text-muted-foreground">{timeStr}</div>
                                            <div className="text-xs text-blue-600 mt-1">{slot.capacity} cupos</div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>

            </section>
        </div>
    );
}
