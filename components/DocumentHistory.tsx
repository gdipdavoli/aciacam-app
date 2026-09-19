"use client";

import { useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { StorageService } from '@/services/storageService';

type Version = { id: string; archived_at: string; datos: { archivo_path?: string; verificacion_estado?: string } };

export function DocumentHistory({ socioId, tipo }: { socioId: string; tipo: string }) {
    const [versions, setVersions] = useState<Version[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function load() {
        setBusy(true); setError('');
        try {
            const { data, error } = await supabase.from('documentos_socio_versiones')
                .select('id,archived_at,datos').eq('socio_id', socioId).eq('datos->>tipo', tipo)
                .order('archived_at', { ascending: false }).limit(50);
            if (error) throw error;
            setVersions(data || []);
        } catch { setError('No pudimos cargar las versiones. Volvé a intentarlo.'); }
        finally { setBusy(false); }
    }
    async function open(path: string) {
        setBusy(true); setError('');
        try {
            const url = await StorageService.createSignedUrl(path);
            if (!url) throw new Error('Archivo no disponible');
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch { setError('No pudimos abrir esta versión.'); }
        finally { setBusy(false); }
    }
    return <section className="my-4 border-t pt-3">
        <button type="button" className="underline text-sm" disabled={busy} onClick={load}>
            {busy ? 'Cargando…' : 'Ver versiones anteriores'}
        </button>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {versions?.length === 0 && <p className="text-sm">No hay versiones anteriores registradas.</p>}
        {versions && <ul className="mt-2 space-y-2 text-sm">{versions.map(v => <li key={v.id}>
            {new Date(v.archived_at).toLocaleString('es-AR')} · {v.datos.verificacion_estado || 'pendiente'}{' '}
            {v.datos.archivo_path && <button type="button" disabled={busy} className="underline"
                onClick={() => open(v.datos.archivo_path!)}>Abrir archivo anterior</button>}
        </li>)}</ul>}
    </section>;
}
