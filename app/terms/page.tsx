"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/services/supabaseClient';

export default function TermsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [accepted, setAccepted] = useState(false);

    const handleAccept = async () => {
        setLoading(true);
        try {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                alert("Sesión expirada. Por favor iniciá sesión nuevamente.");
                router.replace('/login');
                return;
            }

            const res = await fetch('/api/socios/accept-terms', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`
                }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Falló la aceptación');
            }

            setAccepted(true);
            setTimeout(() => {
                // Force reload to refresh AuthContext state
                window.location.href = '/onboarding';
            }, 1000);

        } catch (e: any) {
            console.error(e);
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    if (accepted) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center', marginTop: '4rem' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>¡Gracias!</h1>
                <p>Redirigiendo a la plataforma...</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '800px', margin: '4rem auto', padding: '2rem', backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '2rem', textAlign: 'center' }}>Términos y Condiciones</h1>

            <div style={{ height: '400px', overflowY: 'auto', padding: '1.5rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--muted))', marginBottom: '2rem', lineHeight: 1.6 }}>
                <p style={{ marginBottom: '1rem' }}><strong>1. Introducción</strong></p>
                <p style={{ marginBottom: '1rem' }}>Bienvenido a la plataforma de gestión de ACIACAM. Al utilizar este servicio, usted acepta cumplir con los siguientes términos y condiciones.</p>

                <p style={{ marginBottom: '1rem' }}><strong>2. Uso del Servicio</strong></p>
                <p style={{ marginBottom: '1rem' }}>Esta plataforma es para uso exclusivo de los socios activos de ACIACAM. El acceso es personal e intransferible.</p>

                <p style={{ marginBottom: '1rem' }}><strong>3. Privacidad</strong></p>
                <p style={{ marginBottom: '1rem' }}>Sus datos personales y médicos están protegidos. ACIACAM se compromete a no compartir esta información con terceros sin su consentimiento explícito, salvo requerimiento legal.</p>

                <p style={{ marginBottom: '1rem' }}><strong>4. Dispensas y Pedidos</strong></p>
                <p style={{ marginBottom: '1rem' }}>Las reservas de productos están sujetas a disponibilidad. ACIACAM se reserva el derecho de modificar o cancelar pedidos en función del stock y la normativa vigente.</p>

                <p style={{ marginBottom: '1rem' }}><strong>5. Responsabilidad</strong></p>
                <p style={{ marginBottom: '1rem' }}>El socio es responsable de mantener actualizada su documentación (REPROCANN, etc.) para acceder a los beneficios del club.</p>

                <p style={{ marginBottom: '1rem' }}><em>Al hacer clic en "Aceptar y Continuar", usted declara haber leído y comprendido estos términos.</em></p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                    onClick={handleAccept}
                    disabled={loading}
                    style={{
                        padding: '1rem 3rem',
                        fontSize: '1.1rem',
                        backgroundColor: 'hsl(var(--primary))',
                        color: 'hsl(var(--primary-foreground))',
                        border: 'none',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        opacity: loading ? 0.7 : 1,
                        fontWeight: 700
                    }}
                >
                    {loading ? 'Procesando...' : 'Aceptar y Continuar'}
                </button>
            </div>
        </div>
    );
}
