"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/services/supabaseClient';
import { resolveInviteSession } from '@/services/inviteSession';
import { AlertCircle, LogIn, RefreshCw, Home } from 'lucide-react';

interface ErrorState {
    code: string;
    description: string;
}

export default function InviteCallbackPage() {
    const router = useRouter();
    const [status, setStatus] = useState('Procesando invitación...');
    const [errorState, setErrorState] = useState<ErrorState | null>(null);

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            if (!cancelled) setErrorState({ code: 'connection_timeout', description: 'La conexión está tardando demasiado. Volvé a intentarlo cuando tengas conexión.' });
        }, 15000);
        resolveInviteSession(supabase, window.location.href).then(() => {
            if (cancelled) return;
            clearTimeout(timer);
            setErrorState(null);
            window.history.replaceState(window.history.state, '', window.location.pathname);
            setStatus('Sesión confirmada. Redirigiendo a creación de contraseña...');
            router.replace('/auth/set-password');
        }).catch((error: unknown) => {
            if (cancelled) return;
            clearTimeout(timer);
            setErrorState({
                code: 'session_error',
                description: error instanceof Error && error.message !== 'SESSION_EXPIRED'
                    ? error.message
                    : 'No encontramos una sesión de invitación. Abrí el enlace del correo en este navegador o recuperá tu contraseña.'
            });
        });
        return () => { cancelled = true; clearTimeout(timer); };
    }, [router]);

    if (errorState) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-background">
                <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-lg text-center space-y-6">
                    <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                        <AlertCircle size={32} />
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-xl font-bold text-foreground">No pudimos completar el acceso</h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {errorState.description}
                        </p>
                    </div>

                    <div className="bg-muted/50 p-4 rounded-xl text-xs text-muted-foreground text-left space-y-1 border border-border">
                        <p className="font-semibold text-foreground">¿Qué puedo hacer?</p>
                        <ul className="list-disc pl-4 space-y-1">
                            <li>Si ya configuraste tu contraseña, ingresá directamente con tus credenciales.</li>
                            <li>Si es tu primera vez o no recordás tu clave, podés restablecerla desde la pantalla de login.</li>
                            <li>O solicitale al administrador que te reenvíe la invitación.</li>
                        </ul>
                    </div>

                    <div className="space-y-3 pt-2">
                        <button
                            onClick={() => router.push('/forgot-password')}
                            className="w-full py-3 px-4 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-all flex items-center justify-center gap-2 text-sm shadow-xs"
                        >
                            <LogIn size={18} />
                            Solicitar enlace para crear mi contraseña
                        </button>

                        <button
                            onClick={() => router.push('/')}
                            className="w-full py-2.5 px-4 bg-secondary text-secondary-foreground font-medium rounded-xl hover:bg-secondary/80 transition-all flex items-center justify-center gap-2 text-xs border border-border"
                        >
                            <Home size={16} />
                            Ir al Inicio
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="bg-card border border-border rounded-2xl p-8 max-w-md w-full shadow-lg text-center space-y-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-spin">
                    <RefreshCw size={24} />
                </div>
                <h2 className="text-lg font-bold text-foreground">{status}</h2>
                <p className="text-sm text-muted-foreground">Por favor espere un momento mientras verificamos tu acceso.</p>
            </div>
        </div>
    );
}
