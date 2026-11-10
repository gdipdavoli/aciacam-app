"use client";

import { useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { StorageService } from '@/services/storageService';
import { formatTimestamp, formatCalendarDate } from '@/app/lib/date-format';

type DocVersion = {
    id: string;
    version: number;
    created_at: string;
    verificacion_estado: string;
    verificacion_obs?: string | null;
    archivo_path?: string | null;
    fecha_emision?: string | null;
    fecha_vencimiento?: string | null;
    is_current: boolean;
};

export function DocumentHistory({ socioId, tipo }: { socioId: string; tipo: string }) {
    const [versions, setVersions] = useState<DocVersion[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function load() {
        setBusy(true);
        setError('');
        try {
            const cleanTipo = (tipo === 'declaracionJurada' || tipo === 'declaracion_jurada') ? 'declaracion_jurada' : tipo;
            const { data: { session } } = await supabase.auth.getSession();
            const headers: Record<string, string> = {};
            if (session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }

            const res = await fetch(`/api/socios/${socioId}/documents?tipo=${encodeURIComponent(cleanTipo)}`, { headers });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Error al cargar historial');
            }

            const allDocs: DocVersion[] = await res.json();
            // Previous versions are records where is_current is false
            const previous = allDocs.filter(d => !d.is_current);
            setVersions(previous);
        } catch {
            setError('No pudimos cargar las versiones anteriores. Volvé a intentarlo.');
        } finally {
            setBusy(false);
        }
    }

    async function open(path: string) {
        setBusy(true);
        setError('');
        try {
            const url = await StorageService.createSignedUrl(path);
            if (!url) throw new Error('Archivo no disponible');
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch {
            setError('No pudimos abrir esta versión.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="my-4 border-t pt-3">
            <button
                type="button"
                className="underline text-sm font-medium text-primary hover:opacity-80"
                disabled={busy}
                onClick={load}
            >
                {busy ? 'Cargando…' : 'Ver versiones anteriores'}
            </button>
            {error && <p role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
            {versions?.length === 0 && <p className="text-sm text-muted-foreground mt-2">No hay versiones anteriores registradas.</p>}
            {versions && versions.length > 0 && (
                <ul className="mt-2 space-y-2 text-sm">
                    {versions.map(v => (
                        <li key={v.id} className="p-2 rounded bg-muted/40 border border-border flex flex-col gap-1">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold">Versión {v.version || 1}</span>
                                <span className="text-muted-foreground">{v.created_at ? formatTimestamp(v.created_at, { includeTime: true }) : '-'}</span>
                            </div>
                            <div className="text-xs flex items-center gap-2">
                                <span>Estado: <strong className="uppercase">{v.verificacion_estado || 'pendiente'}</strong></span>
                                {v.fecha_vencimiento && (
                                    <span className="text-muted-foreground">· Vencimiento: {formatCalendarDate(v.fecha_vencimiento)}</span>
                                )}
                            </div>
                            {v.archivo_path && (
                                <button
                                    type="button"
                                    disabled={busy}
                                    className="underline text-xs text-primary self-start mt-1"
                                    onClick={() => open(v.archivo_path!)}
                                >
                                    Abrir archivo de esta versión
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
