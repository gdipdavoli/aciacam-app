"use client";

import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

/**
 * SessionGate (Root Page)
 * Centralizes redirection logic based on authentication and socio status.
 */
export default function DashboardPage() {
    const { user, isInitialized } = useAuth(); // Use isInitialized instead of loading
    const router = useRouter();

    useEffect(() => {
        // Only decide when AuthContext has EXPLICITLY finished initializing
        if (!isInitialized) return;

        console.log("SessionGate: Checking state...", { user: user?.id, role: user?.rol });

        // 1. No Session? -> Login
        if (!user) {
            console.log("Redirect -> /login");
            router.replace('/login');
            return;
        }

        // 2. Socio Loaded? -> Check Status
        // Assuming 'estado' or similar property logic. 
        const socio = user as any;

        if (socio.estado === 'pendiente') {
            console.log("Redirect -> /pendiente-aprobacion");
            router.replace('/pendiente-aprobacion');
        } else {
            // 3. Active Socio -> Dashboard or Catalog
            if (socio.rol === 'admin') {
                console.log("Redirect -> /admin/socios (Admin)");
                router.replace('/admin/socios');
            } else if (socio.rol === 'staff') {
                console.log("Redirect -> /admin (Staff)");
                router.replace('/admin');
            } else {
                console.log("Redirect -> /variedades (Catalog)");
                router.replace('/variedades');
            }
        }

    }, [user, isInitialized, router]);


    // Show generic loader while deciding
    return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Cargando sesión...</h2>
                <p style={{ color: '#666', fontSize: '0.9rem' }}>Verificando credenciales</p>
            </div>
        </div>
    );
}
