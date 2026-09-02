"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/services/supabaseClient';
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
        if (typeof window === 'undefined') return;

        // 1. Parse Hash and Query Parameters
        const hash = window.location.hash.substring(1);
        const search = window.location.search.substring(1);
        const hashParams = new URLSearchParams(hash);
        const searchParams = new URLSearchParams(search);

        const errorCode = hashParams.get('error_code') || searchParams.get('error_code');
        const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
        const error = hashParams.get('error') || searchParams.get('error');

        // Check for Explicit Errors in URL
        if (errorCode || error || errorDesc) {
            const friendlyDesc = errorCode === 'otp_expired'
                ? 'El enlace de invitación ha expirado o ya fue utilizado previamente.'
                : (errorDesc ? decodeURIComponent(errorDesc.replace(/\+/g, ' ')) : 'El enlace no es válido o ha expirado.');

            setErrorState({
                code: errorCode || error || 'link_invalid',
                description: friendlyDesc
            });
            return;
        }

        if (!supabase) {
            setErrorState({
                code: 'client_error',
                description: 'No se pudo conectar con el servicio de autenticación.'
            });
            return;
        }

        // 2. Check for Hash Tokens (Implicit Flow: #access_token=...&refresh_token=...)
        const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');

        if (accessToken) {
            setStatus('Iniciando sesión con tu invitación...');
            supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken || ''
            }).then(({ data, error: setSessionError }) => {
                if (setSessionError || !data.session) {
                    console.error("InviteCallback SetSession Error:", setSessionError);
                    setErrorState({
                        code: 'token_expired',
                        description: 'El token de acceso ha expirado o fue consumido previamente.'
                    });
                } else {
                    setStatus('Sesión confirmada. Redirigiendo a creación de contraseña...');
                    router.replace('/auth/set-password');
                }
            });
            return;
        }

        // 3. Check for PKCE Code (?code=...)
        const code = searchParams.get('code');
        if (code) {
            setStatus('Validando código de invitación...');
            supabase.auth.exchangeCodeForSession(code).then(({ data, error: exchangeError }) => {
                if (exchangeError || !data.session) {
                    console.error("InviteCallback Exchange Error:", exchangeError);
                    setErrorState({
                        code: 'code_expired',
                        description: 'El código de autorización expiró o no es válido.'
                    });
                } else {
                    setStatus('Sesión confirmada. Redirigiendo...');
                    router.replace('/auth/set-password');
                }
            });
            return;
        }

        // 4. Fallback: Listen to Auth state changes or check active session
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log("InviteCallback: Auth Event:", event, session?.user?.email);
            if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && session)) {
                setStatus('Sesión detectada. Redirigiendo...');
                router.replace('/auth/set-password');
            }
        });

        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                setStatus('Sesión activa. Redirigiendo...');
                router.replace('/auth/set-password');
            }
        });

        // 5. Safety Timeout: If no session/tokens resolved after 3.5s
        const timer = setTimeout(() => {
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (!session) {
                    setErrorState({
                        code: 'timeout',
                        description: 'El enlace de invitación ha expirado o ya fue procesado.'
                    });
                }
            });
        }, 3500);

        return () => {
            subscription.unsubscribe();
            clearTimeout(timer);
        };
    }, [router]);

    if (errorState) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-background">
                <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-lg text-center space-y-6">
                    <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                        <AlertCircle size={32} />
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-xl font-bold text-foreground">Enlace Expirado o Ya Utilizado</h2>
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
                            onClick={() => router.push('/login')}
                            className="w-full py-3 px-4 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-all flex items-center justify-center gap-2 text-sm shadow-xs"
                        >
                            <LogIn size={18} />
                            Iniciar Sesión / Recuperar Clave
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
