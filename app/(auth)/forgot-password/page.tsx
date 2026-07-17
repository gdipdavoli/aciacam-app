'use client';

import { useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import Link from 'next/link';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!supabase) {
            setError("Error de configuración.");
            return;
        }
        setLoading(true);
        setError(null);
        setMessage(null);

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });

        if (error) {
            setError(error.message);
        } else {
            setMessage('Si el email existe en nuestra base, recibirás un enlace para restablecer tu contraseña. Revisa tu correo (y spam).');
        }
        setLoading(false);
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsl(var(--background))' }}>
            <div style={{ padding: '2rem', maxWidth: '400px', width: '100%', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', textAlign: 'center' }}>Recuperar Contraseña</h1>

                <p style={{ fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))', marginBottom: '1.5rem', textAlign: 'center' }}>
                    Ingresa tu email y te enviaremos un enlace para crear una nueva contraseña.
                </p>

                {message ? (
                    <div style={{ padding: '1rem', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                        {message}
                    </div>
                ) : (
                    <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                        {error && (
                            <div style={{ padding: '0.75rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontSize: '0.9rem' }}>
                                {error}
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label htmlFor="email" style={{ fontSize: '0.9rem', fontWeight: 500 }}>Email</label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                style={{ padding: '0.6rem', border: '1px solid hsl(var(--border))', borderRadius: '4px' }}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                marginTop: '0.5rem',
                                padding: '0.75rem',
                                backgroundColor: 'hsl(var(--primary))',
                                color: 'hsl(var(--primary-foreground))',
                                border: 'none',
                                borderRadius: '4px',
                                fontWeight: 600,
                                cursor: loading ? 'wait' : 'pointer'
                            }}
                        >
                            {loading ? 'Enviando...' : 'Enviar Enlace'}
                        </button>
                    </form>
                )}

                <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                    <Link href="/login" style={{ fontSize: '0.9rem', color: 'hsl(var(--primary))', textDecoration: 'none' }}>
                        Volver al Login
                    </Link>
                </div>
            </div>
        </div>
    );
}
