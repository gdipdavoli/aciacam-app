"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/services/supabaseClient';

export default function InviteCallbackPage() {
    const router = useRouter();
    const [status, setStatus] = useState('Procesando invitación...');

    useEffect(() => {
        if (!supabase) return;

        // The Supabase Client Component automatically handles the URL hash (Implicit Flow).
        // We just need to wait for the session to be established.

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log("InviteCallback: Auth Event:", event);

            if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && session)) {
                setStatus('Sesión iniciada. Redirigiendo...');
                // Force replacement to Set Password
                router.replace('/auth/set-password');
            } else if (event === 'SIGNED_OUT') {
                // Wait a bit, sometimes it fires signed_out before processing the hash?
                // No, usually it's mostly stable.
            }
        });

        // Fallback: Check if we already have a session?
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                router.replace('/auth/set-password');
            }
        });

        return () => {
            subscription.unsubscribe();
        }
    }, [router]);

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            flexDirection: 'column',
            gap: '1rem',
            fontFamily: 'var(--font-heading)'
        }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{status}</h2>
            <p style={{ color: '#666' }}>Por favor espere un momento.</p>
        </div>
    );
}
