"use client";

import React, { useEffect, useState } from 'react';
import { supabase } from '@/services/supabaseClient';

export type PickupSlot = {
    id: string;
    start_time: string;
    end_time: string;
    capacity: number;
    bookings_count?: number; // Depending on if we expose this view
    status: string;
};

interface SlotSelectorProps {
    selectedSlotId: string | null;
    onSelect: (slotId: string, slotLabel: string, slotDate: string) => void;
}

export function SlotSelector({ selectedSlotId, onSelect }: SlotSelectorProps) {
    const [slots, setSlots] = useState<PickupSlot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchSlots = async () => {
            if (!supabase) {
                setError("Error: Cliente Supabase no inicializado.");
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                // Fetch active slots for next 30 days
                const now = new Date().toISOString();
                const { data, error } = await supabase
                    .from('pickup_slots')
                    .select('*')
                    .eq('status', 'active')
                    .gt('start_time', now) // Only future
                    .order('start_time', { ascending: true })
                    .limit(50);

                if (error) throw error;
                setSlots(data || []);
            } catch (err: any) {
                console.error("Error fetching slots:", err);
                setError('No se pudieron cargar los turnos disponibles.');
            } finally {
                setLoading(false);
            }
        };

        fetchSlots();
    }, []);

    const [showAll, setShowAll] = useState(false);

    // Group by Date
    const grouped = slots.reduce((acc, slot) => {
        // Capitalize Date
        let date = new Date(slot.start_time).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
        date = date.charAt(0).toUpperCase() + date.slice(1);

        if (!acc[date]) acc[date] = [];
        acc[date].push(slot);
        return acc;
    }, {} as Record<string, PickupSlot[]>);

    const dates = Object.keys(grouped);
    const displayedDates = showAll ? dates : dates.slice(0, 3);
    const hasMore = dates.length > 3;

    if (loading) return <div className="p-4 text-center text-muted-foreground">Cargando turnos...</div>;
    if (error) return <div className="p-4 text-destructive">{error}</div>;
    if (slots.length === 0) return <div className="p-4 text-muted-foreground">No hay turnos disponibles próximamente.</div>;

    const formatTime = (iso: string) => {
        return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }

    return (
        <div className="flex flex-col gap-3 mt-2">
            {displayedDates.map((dateLabel) => {
                const daySlots = grouped[dateLabel];
                return (
                    <div key={dateLabel} className="border rounded-lg p-3 bg-card/50 hover:bg-card transition-colors">
                        <h4 className="font-medium mb-3 text-sm text-foreground/80 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/60"></span>
                            {dateLabel}
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {daySlots.map(slot => {
                                const isSelected = selectedSlotId === slot.id;
                                const label = `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`;

                                return (
                                    <button
                                        key={slot.id}
                                        onClick={() => onSelect(slot.id, `${dateLabel} ${label}`, slot.start_time)}
                                        className={`
                                            px-2 py-1.5 rounded text-xs border transition-all text-center
                                            ${isSelected
                                                ? 'bg-primary text-primary-foreground border-primary shadow-sm font-medium'
                                                : 'bg-background border-input hover:border-primary/50 hover:bg-accent text-muted-foreground'
                                            }
                                        `}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {hasMore && (
                <button
                    onClick={() => setShowAll(!showAll)}
                    className="mt-2 text-sm text-primary hover:underline font-medium flex items-center justify-center gap-1 py-2"
                >
                    {showAll ? 'Ver menos días' : `Ver más días disponibles (+${dates.length - 3})`}
                </button>
            )}
        </div>
    );
}
