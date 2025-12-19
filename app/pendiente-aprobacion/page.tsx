"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

export default function PendientePage() {
    const router = useRouter();

    return (
        <div style={{ padding: '4rem', textAlign: 'center' }}>
            <h1>Cuenta Pendiente de Aprobación</h1>
            <p>Tu cuenta ha sido creada y verificada, pero aún no tiene permisos para acceder.</p>
            <p>Por favor contactá al administrador.</p>
            <button onClick={() => router.push('/login')} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
                Volver al Login
            </button>
        </div>
    );
}
