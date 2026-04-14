"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Socio } from '@/types';
import { supabase } from '@/services/supabaseClient'; // Singleton
import { StoreService } from '@/services/storeService';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
    user: Socio | null;
    session: any | null; // Typed loosely for now validation
    loading: boolean;
    authError?: string | null;
    isUnlinked?: boolean;
    isInitialized: boolean;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<Socio | null>(null);
    const [session, setSession] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [isInitialized, setInitialized] = useState(false); // New explicit flag
    const [authError, setAuthError] = useState<string | null>(null);
    const [isUnlinked, setIsUnlinked] = useState(false);
    const router = useRouter();
    const pathname = usePathname(); // Reactive path

    // Guards to prevent double-fire in StrictMode
    const initRef = React.useRef(false);
    const fetchLock = React.useRef<string | null>(null);
    const currentUserIdRef = React.useRef<string | null>(null);

    useEffect(() => {
        if (!supabase) {
            console.error("AuthContext: Supabase client not initialized");
            setLoading(false);
            setInitialized(true); // Treat as initialized even if failed
            return;
        }

        if (initRef.current) return;
        initRef.current = true;

        // Safety Timeout: Force loading false after 15 seconds (increased from 8s)
        const safetyTimer = setTimeout(() => {
            setLoading(prev => {
                if (prev) {
                    console.warn("AuthContext: Safety Timeout triggered. Forcing loading false.");
                    setAuthError("La conexión con el servidor está tardando más de lo esperado. Por favor, intente recargar la página.");
                    setInitialized(true);
                    return false;
                }
                return prev;
            });
        }, 30000); // Increased to 30s

        const handleUserSession = async (userId: string, session: any) => {
            // DEDUPLICATION: Prevent parallel fetches for the same user
            if (fetchLock.current === userId) {
                console.log(`[AuthDebug] handleUserSession ignored for ${userId} (Already in progress)`);
                return;
            }
            fetchLock.current = userId;

            // ... (keep handleUserSession logic as is, it's fine)
            console.log("AuthContext: Handling User Session for", userId);
            setAuthError(null);
            setIsUnlinked(false);

            try {
                // 1. Fetch Socio (With Timeout Fix)
                console.time("fetchSocio");

                // Create a timeout promise for the fetch
                const fetchPromise = StoreService.getSocioByUserId(userId);
                const fetchTimeout = new Promise<null>((_, reject) =>
                    setTimeout(() => reject(new Error('Fetch Socio Timeout')), 20000) // Increased to 20s
                );

                const socio = await Promise.race([fetchPromise, fetchTimeout]) as Socio | null;
                console.timeEnd("fetchSocio");

                if (socio) {
                    console.log("AuthContext: Socio found linked:", socio.id);

                    // Override role if Admin in Metadata (Source of Truth)
                    // Use passed session instead of awaiting getSession() again
                    const authRole = session?.user?.app_metadata?.role;
                    if (authRole === 'admin') {
                        socio.rol = 'admin';
                    }

                    currentUserIdRef.current = session.user.id;
                    setUser(socio);

                    // 2. EXPLICIT REDIRECT LOGIC
                    console.log("AuthContext: Checking Path for Redirect:", pathname);
                    // (Redirects handled in reactive effect)

                } else {
                    console.warn("AuthContext: User authenticated but NO socio linked.");
                    setIsUnlinked(true);
                    currentUserIdRef.current = null;
                    setUser(null);

                    // Allow Auth Setup Pages to proceed without redirect loop
                    if (!pathname?.startsWith('/auth/')) {
                        router.replace('/pendiente-aprobacion');
                    }
                }
            } catch (fetchErr: any) {
                console.error("AuthContext: Fetch Socio Failed. Details:", fetchErr);
                setAuthError(`Error cargando perfil: ${fetchErr.message}`);
            } finally {
                console.log("AuthContext: handleUserSession finally block reached.");
                fetchLock.current = null; // Release Lock
                setLoading(false);
                setInitialized(true);
                clearTimeout(safetyTimer); // Clear timeout if successful
            }
        };

        // 1. SETUP LISTENER FIRST (To catch events even if getSession hangs)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log(`[AuthDebug] ${new Date().toISOString()} Auth Event: ${event}`);

            if (event === 'SIGNED_IN' && session?.user) {
                console.log("[AuthDebug] SIGNED_IN. Starting handleUserSession.");
                // Only set loading true if we are not already initialized or if switching users
                if (currentUserIdRef.current !== session.user.id) {
                    setLoading(true);
                }
                setSession(session);
                await handleUserSession(session.user.id, session);
            } else if (event === 'TOKEN_REFRESHED') {
                console.log("[AuthDebug] Token Refreshed.");
            } else if (event === 'SIGNED_OUT') {
                console.log("[AuthDebug] SIGNED_OUT. Cleaning up.");
                currentUserIdRef.current = null;
                setUser(null);
                setIsUnlinked(false);
                setLoading(false);
                setInitialized(true);
                router.replace('/login');
            }
        });

        // 2. INITIALIZE SESSION
        const initSession = async () => {
            if (!supabase) return;

            console.log(`[AuthDebug] ${new Date().toISOString()} Starting initSession`);
            setLoading(true);

            try {
                // RACE CONDITION FIX: Wrap getSession in a timeout
                // 12 Seconds Timeout (Increased)
                const sessionPromise = supabase.auth.getSession();
                const timeoutPromise = new Promise<{ data: { session: null }, error: any }>((resolve) =>
                    setTimeout(() => resolve({ data: { session: null }, error: new Error('Session Init Timeout') }), 20000) // Increased to 20s
                );

                const { data: { session }, error } = await Promise.race([sessionPromise, timeoutPromise]) as any;

                console.log(`[AuthDebug] ${new Date().toISOString()} getSession result:`, session ? "Session Found" : "No Session", error ? error.message : "No Error");

                if (error && error.message !== 'Session Init Timeout') throw error;
                if (error && error.message === 'Session Init Timeout') {
                    console.warn("[AuthDebug] Session Timed Out - Treating as no session.");
                }

                if (session?.user) {
                    setSession(session);
                    await handleUserSession(session.user.id, session);
                } else {
                    console.log(`[AuthDebug] ${new Date().toISOString()} No session user (getSession). Finishing init.`);
                    setLoading(false);
                    setInitialized(true);
                    clearTimeout(safetyTimer);
                }

            } catch (e: any) {
                console.error(`[AuthDebug] ${new Date().toISOString()} initSession Error:`, e);

                // TIMEOUT FALLBACK: Don't assume logged out yet. 
                // Let the onAuthStateChange listener (setup above) handle it if an event fires.
                if (e.message === 'Session Init Timeout') {
                    console.warn("[AuthDebug] Aborting strict init due to timeout.");
                    // We DO NOT set loading(false) immediately if we think an event might come.
                    // But to avoid infinite spinner, we check getUser() as last resort.

                    try {
                        const { data: { user } } = await supabase.auth.getUser();
                        if (user) {
                            console.log("[AuthDebug] Recovered session via getUser()");
                            await handleUserSession(user.id, null); // Session might be missing but user is there
                            return;
                        }
                    } catch (innerErr) {
                        console.error("[AuthDebug] Fallback getUser failed", innerErr);
                    }

                    // If all failed, finish.
                    setLoading(false);
                    setInitialized(true);
                    clearTimeout(safetyTimer);
                    return;
                }

                if (e?.message?.includes('Refresh Token Not Found') || e?.message?.includes('Invalid Refresh Token')) {
                    console.warn("AuthContext: Refresh Token invalid. Clearing session.");
                    if (supabase) await supabase.auth.signOut();
                    setUser(null);
                    router.replace('/login');
                }

                setLoading(false);
                setInitialized(true);
                clearTimeout(safetyTimer);
            }
        };

        initSession();

        return () => {
            clearTimeout(safetyTimer);
            subscription.unsubscribe();
        };
    }, [router]);

    // SEPARATE EFFECT FOR REACTIVE GATE & REDIRECTS
    useEffect(() => {
        if (!loading && user) {
            const isExempt =
                pathname === '/login' ||
                pathname === '/terms' ||
                pathname?.startsWith('/auth/');

            // 1. TERMS GATE
            if (!user.terms_accepted_at && !isExempt) {
                console.log("AuthContext (Reactive): Terms enforcement");
                router.replace('/terms');
                return;
            }

            // 2. LOGIN REDIRECT (Logged in user shouldn't be on /login or root)
            if (pathname === '/login' || pathname === '/') {
                if (user.rol === 'admin' || user.rol === 'staff') {
                    router.replace('/admin');
                } else {
                    router.replace('/variedades');
                }
            }
        }
    }, [pathname, user, loading, router]);

    const logout = async () => {
        if (supabase) {
            await supabase.auth.signOut();
        } else {
            currentUserIdRef.current = null;
            setUser(null);
            setSession(null); // Clear session state on manual logout
            router.push('/login');
        }
    };

    const refreshUser = async () => {
        if (!session?.user?.id) return;
        try {
            const socio = await StoreService.getSocioByUserId(session.user.id);
            if (socio) {
                // Keep admin role override logic if applicable
                const authRole = session?.user?.app_metadata?.role;
                if (authRole === 'admin') {
                    socio.rol = 'admin';
                }
                setUser(socio);
            }
        } catch (error) {
            console.error("AuthContext: refreshUser failed", error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, isInitialized, logout, refreshUser, authError, isUnlinked }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
