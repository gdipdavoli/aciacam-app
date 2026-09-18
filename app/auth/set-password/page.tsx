"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/services/supabaseClient';
import { resolveInviteSession } from '@/services/inviteSession';

export default function SetPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const [sessionReady, setSessionReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Email templates can redirect here directly with credentials in the URL.
        resolveInviteSession(supabase, window.location.href).then(() => {
            if (cancelled) return;
            window.history.replaceState(window.history.state, '', window.location.pathname);
            setSessionReady(true);
        }).catch((err: unknown) => {
            if (!cancelled) setError(err instanceof Error ? err.message : 'No pudimos validar tu sesión.');
        }).finally(() => {
            if (!cancelled) setCheckingSession(false);
        });
        return () => { cancelled = true; };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (loading || !sessionReady) return;
        setError(null);

        if (password !== confirm) {
            setError("Las contraseñas no coinciden.");
            return;
        }

        if (password.length < 6) {
            setError("La contraseña debe tener al menos 6 caracteres.");
            return;
        }

        setLoading(true);

        try {
            if (!supabase) throw new Error("Supabase no inicializado");

            // 1. Verify session exists
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError("SESSION_EXPIRED");
                setLoading(false);
                return;
            }

            // Save the password before consuming any invitation.
            const { error: updateError } = await supabase.auth.updateUser({
                password: password
            });

            if (updateError) throw updateError;

            // Invitation tracking must never prevent the password from being saved.
            if (session.user.email) {
                const { data: invite } = await supabase
                    .from('socio_invites')
                    .select('id, status, expires_at')
                    .eq('email', session.user.email)
                    .is('consumed_at', null)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (invite) {
                    await supabase
                        .from('socio_invites')
                        .update({ 
                            consumed_at: new Date().toISOString(),
                            status: 'consumed'
                        })
                        .eq('id', invite.id);
                }
            }

            const { data: { user } } = await supabase.auth.getUser();
            let targetRoute = '/terms';

            if (user) {
                const { data: socio } = await supabase
                    .from('socios')
                    .select('rol')
                    .eq('auth_user_id', user.id)
                    .single();

                if (socio && (socio.rol === 'admin' || socio.rol === 'staff')) {
                    targetRoute = '/admin';
                }
            }

            // Route
            router.replace(targetRoute);

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Error al guardar la contraseña.";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    if (checkingSession) return <p role="status" className="p-10 text-center">Validando tu invitación...</p>;

    if (!sessionReady || error === "SESSION_EXPIRED") {
        return (
            <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', textAlign: 'center' }}>
                <h1 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: 'hsl(var(--destructive))' }}>No pudimos validar tu sesión</h1>
                <p style={{ marginBottom: '1.5rem', color: 'hsl(var(--muted-foreground))' }}>
                    {error && error !== 'SESSION_EXPIRED' ? error : 'Abrí el botón del correo original en este navegador. Si el enlace ya fue utilizado, solicitá uno nuevo para crear tu contraseña.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <button
                        onClick={() => router.push('/forgot-password')}
                        style={{ padding: '0.75rem', backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
                        Solicitar enlace para crear mi contraseña
                    </button>
                    {/* Optional: Mailto help */}
                    <a href="mailto:soporte@aciacam.org" style={{ fontSize: '0.9rem', color: 'hsl(var(--primary))' }}>Contactar Soporte</a>
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', textAlign: 'center' }}>Crear Contraseña</h1>
            <p style={{ marginBottom: '1.5rem', color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>
                Para completar la activación de tu cuenta, por favor definí una contraseña segura.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                    <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Nueva Contraseña</label>
                    <input
                        id="password"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                    />
                </div>
                <div>
                    <label htmlFor="confirm" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Confirmar Contraseña</label>
                    <input
                        id="confirm"
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                    />
                </div>

                {error && <div role="alert" style={{ color: 'red', fontSize: '0.9rem' }}>{error}</div>}

                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        marginTop: '1rem',
                        padding: '0.75rem',
                        backgroundColor: 'hsl(var(--primary))',
                        color: 'hsl(var(--primary-foreground))',
                        border: 'none',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        opacity: loading ? 0.7 : 1
                    }}
                >
                    {loading ? 'Guardando...' : 'Guardar y Continuar'}
                </button>
            </form>
        </div>
    );
}
