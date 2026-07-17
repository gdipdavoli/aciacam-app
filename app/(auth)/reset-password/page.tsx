'use client';

import { useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const router = useRouter();

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirm) {
            setError('Las contraseñas no coinciden');
            return;
        }

        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        if (!supabase) {
            setError("Error de configuración.");
            return;
        }

        setLoading(true);
        setError(null);

        const { error } = await supabase.auth.updateUser({
            password: password
        });

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            setSuccess(true);
            setTimeout(() => {
                router.push('/');
            }, 2000);
        }
    };

    if (success) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsl(var(--background))' }}>
                <div style={{ padding: '2rem', maxWidth: '400px', width: '100%', textAlign: 'center', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))' }}>
                    <h1 style={{ fontSize: '1.5rem', color: '#166534', marginBottom: '1rem' }}>¡Contraseña Actualizada!</h1>
                    <p>Redirigiendo al inicio...</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsl(var(--background))' }}>
            <div style={{ padding: '2rem', maxWidth: '400px', width: '100%', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: 'center' }}>Nueva Contraseña</h1>

                <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {error && (
                        <div style={{ padding: '0.75rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontSize: '0.9rem' }}>
                            {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label htmlFor="password" style={{ fontSize: '0.9rem', fontWeight: 500 }}>Contraseña</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            style={{ padding: '0.6rem', border: '1px solid hsl(var(--border))', borderRadius: '4px' }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label htmlFor="confirm" style={{ fontSize: '0.9rem', fontWeight: 500 }}>Repetir Contraseña</label>
                        <input
                            id="confirm"
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
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
                        {loading ? 'Actualizar' : 'Establecer Contraseña'}
                    </button>
                </form>
            </div>
        </div>
    );
}
