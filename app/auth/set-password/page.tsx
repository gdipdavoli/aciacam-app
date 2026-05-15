"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/services/supabaseClient';

export default function SetPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
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

            // 2. Hallazgo #2: Verificar que el correo tenga una invitación válida en DB
            // Solo permitimos el acceso si hay una invitación pendiente y no expirada.
            const { data: invite, error: inviteError } = await supabase
                .from('socio_invites')
                .select('id, status, expires_at')
                .eq('email', session.user.email)
                .is('consumed_at', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (inviteError || !invite) {
                setError("No se encontró una invitación válida o activa para este correo. Por favor contacte a soporte.");
                setLoading(false);
                return;
            }

            if (new Date(invite.expires_at) < new Date()) {
                setError("Tu invitación ha expirado. Solicitá un nuevo acceso.");
                setLoading(false);
                return;
            }

            // 3. Actualizar contraseña en Auth
            const { error: updateError } = await supabase.auth.updateUser({
                password: password
            });

            if (updateError) throw updateError;

            // 4. Mark invite as consumed
            await supabase
                .from('socio_invites')
                .update({ 
                    consumed_at: new Date().toISOString(),
                    status: 'consumed'
                })
                .eq('id', invite.id);

            // Success!
            // We can now proceed to Terms or Onboarding.

            // 5. Fetch Role to Decide Redirect
            // If Session is active, we can get the user.
            const { data: { user } } = await supabase.auth.getUser();
            const userRole = user?.user_metadata?.role || user?.app_metadata?.role;

            // Simple Check: If staff/admin, go to dashboard directly.
            // If role is not in metadata yet (might need DB fetch?), we default to terms/onboarding.

            // To be robust: Fetch socio from API or DB?
            // Actually, metadata 'role' should be there if our Inviter put it there? 
            // Inviter puts it in public.socios table... triggers sync it to auth metadata? 
            // In our current setup, we might NOT rely on metadatasync if not implemented.
            // Let's safe bet: Query public.socios by user_id

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
            // Only stop loading if we didn't return early
            if (loading) setLoading(false);
        }
    };

    if (error === "SESSION_EXPIRED") {
        return (
            <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', textAlign: 'center' }}>
                <h1 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: 'hsl(var(--destructive))' }}>Enlace Expirado o Sesión Inválida</h1>
                <p style={{ marginBottom: '1.5rem', color: 'hsl(var(--muted-foreground))' }}>
                    No pudimos detectar tu sesión de invitación. Esto puede pasar si el enlace ya fue usado o expiró.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <button
                        onClick={() => router.push('/login')}
                        style={{ padding: '0.75rem', backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
                        Ir al Login / Recuperar cuenta
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
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Nueva Contraseña</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Confirmar Contraseña</label>
                    <input
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--input))' }}
                    />
                </div>

                {error && <div style={{ color: 'red', fontSize: '0.9rem' }}>{error}</div>}

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
