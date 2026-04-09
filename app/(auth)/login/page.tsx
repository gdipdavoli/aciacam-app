'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/services/supabaseClient';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import PWAInstaller from '@/app/components/PWAInstaller';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    const { authError, isInitialized, user } = useAuth(); // Connect to Context

    // Effect: React to Context Error or Success
    useEffect(() => {
        if (authError) {
            setLoading(false);
            setError(authError);
        }

        // Safety Fallback: If user is detected (AuthContext has finished loading user),
        // we should redirect even if AuthContext handles it globally, to update UI state.
        if (user) {
            console.log("LoginPage: User detected. Redirecting...");
            setLoading(true); // Keep spinner
            // Short delay to allow Context to do its job, otherwise force it
            const timer = setTimeout(() => {
                if (user.rol === 'admin' || user.rol === 'staff') {
                    router.push('/admin');
                } else {
                    router.push('/variedades');
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [authError, user, router]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();

        // Client-side validation to prevent AuthApiError
        if (!email?.trim() || !password?.trim()) {
            setError("Por favor complete todos los campos.");
            return;
        }

        if (!supabase) {
            setError("Error de configuración (Supabase Client missing)");
            return;
        }

        setLoading(true);
        setError(null);

        console.log("Attempting login with email:", email);

        const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
        });

        if (error) {
            console.error("Login Error:", error);
            setError(error.message);
            setLoading(false);
        } else {
            console.log("Login Action Successful. Waiting for AuthContext redirect...");
            // Keep loading true. AuthContext listener will trigger `handleUserSession`.
        }
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsl(var(--background))' }}>
            <div style={{ padding: '2rem', maxWidth: '400px', width: '100%', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))' }}>
                <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center' }}>
                    <picture style={{ display: 'block', width: '130px', height: 'auto' }}>
                        <source srcSet="/logo-night.png" media="(prefers-color-scheme: dark)" />
                        <img src="/logo-day.png" alt="ACIACAM" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} />
                    </picture>
                </div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: 'center' }}>Ingresar</h1>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

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
                            autoComplete="username"
                            style={{ padding: '0.6rem', border: '1px solid hsl(var(--border))', borderRadius: '4px', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label htmlFor="password" style={{ fontSize: '0.9rem', fontWeight: 500 }}>Contraseña</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            style={{ padding: '0.6rem', border: '1px solid hsl(var(--border))', borderRadius: '4px', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                        />
                        <div style={{ textAlign: 'right' }}>
                            <Link href="/forgot-password" style={{ fontSize: '0.8rem', color: 'hsl(var(--primary))', textDecoration: 'none' }}>
                                ¿Olvidaste tu contraseña?
                            </Link>
                        </div>
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
                        {loading ? 'Ingresando...' : 'Ingresar'}
                    </button>
                </form>

                <PWAInstaller />
            </div>
        </div>
    );
}
