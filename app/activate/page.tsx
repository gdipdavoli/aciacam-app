'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/services/supabaseClient';

function ActivateContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get('token');
    const urlError = searchParams.get('error'); // Error passed by Supabase or Middleware
    const urlErrorDesc = searchParams.get('error_description');

    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<'validating' | 'valid' | 'invalid' | 'processing' | 'setting_password' | 'success'>('validating');
    const [error, setError] = useState('');
    const [inviteData, setInviteData] = useState<{ email: string, socioName: string } | null>(null);

    // Password State
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [settingPassLoading, setSettingPassLoading] = useState(false);

    // 4. Check if already logged in
    useEffect(() => {
        const checkSession = async () => {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            // If logged in, and NOT in the middle of consuming (flow=consume), redirect.
            // If flow=consume, we ARE logged in but need to finish the logic below.
            const flow = searchParams.get('flow');
            if (session?.user && flow !== 'consume') {
                router.replace('/portal');
            }
        };
        checkSession();
    }, [router, searchParams]);

    useEffect(() => {
        // 1. Handle URL Errors (e.g. from Supabase Redirect)
        if (urlError) {
            console.warn("URL Error:", urlError, urlErrorDesc); // Changed to warn to avoid error overlay
            setStatus('invalid');
            setError(`Error de autenticación: ${urlErrorDesc || urlError}. Intenta solicitar el link de nuevo.`);
            setLoading(false);
            return;
        }

        // 2. Handle Missing Token
        if (!token) {
            // Only show invalid if we didn't redirect above (which happens async). 
            // Better to wait for session check? 
            // Actually, if logged in, the redirect happens. 
            // If not logged in and no token -> Invalid.
            setStatus('invalid');
            setError('No se proporcionó un token de activación.');
            setLoading(false);
            return;
        }

        // 3. Validate Token
        fetch(`/api/activate/validate?token=${token}`)
            .then(async res => {
                if (res.ok) return res.json();
                throw new Error((await res.json()).error || 'Token inválido');
            })
            .then(data => {
                setInviteData(data);
                setStatus('valid');
                setLoading(false);
            })
            .catch(err => {
                setStatus('invalid');
                setError(err.message);
                setLoading(false);
            });

    }, [token, urlError, urlErrorDesc]);

    const handleLogin = async () => {
        if (!inviteData || !supabase) return;

        setLoading(true);
        setStatus('processing');
        setError('');

        const { error } = await supabase.auth.signInWithOtp({
            email: inviteData.email,
            options: {
                emailRedirectTo: `${window.location.origin}/activate?token=${token}&flow=consume`,
            }
        });

        if (error) {
            setError(error.message);
            setStatus('valid');
            setLoading(false);
        } else {
            alert(`Link de acceso enviado a ${inviteData.email}. Revisá tu correo.`);
            setLoading(false);
        }
    };

    const handleFinalize = async () => {
        if (password !== confirm) {
            setError('Las contraseñas no coinciden');
            return;
        }
        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        setSettingPassLoading(true);
        setError('');

        if (!supabase) return;

        // 1. Update Password
        const { error: updateError } = await supabase.auth.updateUser({ password: password });

        if (updateError) {
            setError(updateError.message);
            setSettingPassLoading(false);
            return;
        }

        // 2. Consume Invite
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            setError("Sesión expirada.");
            setSettingPassLoading(false);
            return;
        }

        fetch('/api/activate/consume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                access_token: session.access_token,
                password_set: true
            })
        })
            .then(async res => {
                if (res.ok) return res.json();
                throw new Error((await res.json()).error || 'Error al vincular cuenta');
            })
            .then(() => {
                setStatus('success');
                setTimeout(() => {
                    router.push('/portal');
                }, 2000);
            })
            .catch(err => {
                setError(err.message);
                setSettingPassLoading(false);
            });
    };

    // UseEffect to Handle Link Consumption AFTER Login
    useEffect(() => {
        const flow = searchParams.get('flow');
        if (flow === 'consume' && token && supabase) {
            // We just came back from Magic Link.
            // We should have a session now.
            setLoading(true);
            setStatus('processing');

            supabase.auth.getSession().then(({ data: { session } }) => {
                if (!session) {
                    setError("No se pudo iniciar sesión. El link puede haber expirado.");
                    setStatus('valid'); // Let them try clicking "Ingresar" again
                    setLoading(false);
                    return;
                }

                // Check if we need to set password?
                // For now, ALWAYS ask for password on activation if user doesn't have metadata saying otherwise?
                // Or just show the form.
                setStatus('setting_password');
                setLoading(false);
            });
        }
    }, [searchParams, token, router]);


    // --- RENDERS ---

    if (loading && status === 'validating') return <div className="p-10 text-center">Validando invitación...</div>;
    if (loading && status === 'processing') return <div className="p-10 text-center">Procesando...</div>;

    if (status === 'invalid') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
                <div className="bg-card p-8 rounded shadow-md max-w-md w-full text-center border border-border">
                    <h1 className="text-xl font-bold text-red-600 mb-4">Problema con la Invitación</h1>
                    <p className="mb-4">{error}</p>
                    <button onClick={() => router.push('/')} className="text-blue-600 underline">Ir al inicio</button>
                </div>
            </div>
        );
    }

    if (status === 'setting_password') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
                <div className="bg-card p-8 rounded shadow-md max-w-md w-full border border-border">
                    <h1 className="text-xl font-bold mb-4 text-center">Crear Contraseña</h1>
                    <p className="text-sm text-muted-foreground mb-6 text-center">Establece una contraseña para tu cuenta.</p>
                    {error && <div className="mb-4 p-2 bg-red-100 text-red-700 text-sm rounded">{error}</div>}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-foreground">Contraseña</label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full rounded-md border-input shadow-sm p-2 border bg-background text-foreground" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-foreground">Repetir Contraseña</label>
                            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-1 block w-full rounded-md border-input shadow-sm p-2 border bg-background text-foreground" />
                        </div>
                        <button onClick={handleFinalize} disabled={settingPassLoading} className="w-full py-2 px-4 bg-green-600 text-white rounded hover:bg-green-700 transition font-bold">
                            {settingPassLoading ? 'Guardando...' : 'Finalizar Activación'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'success') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-green-50/10">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-primary mb-4">¡Cuenta Activada!</h1>
                    <p>Bienvenido, {inviteData?.socioName || 'Socio'}.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
            <div className="bg-card p-8 rounded shadow-md max-w-md w-full text-center border border-border">
                <h1 className="text-2xl font-bold mb-2">Activación</h1>
                {inviteData && <p className="mb-6 text-muted-foreground">Hola <strong>{inviteData.socioName}</strong></p>}

                <button onClick={handleLogin} className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
                    Ingresar y Crear Contraseña
                </button>
                {error && <p className="mt-4 text-red-500 text-sm">{error}</p>}
            </div>
        </div>
    );
}

export default function ActivatePage() {
    return (
        <Suspense fallback={<div className="p-10 text-center">Cargando...</div>}>
            <ActivateContent />
        </Suspense>
    );
}
