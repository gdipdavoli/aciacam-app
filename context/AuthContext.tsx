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
            setInitialized(true);
            return;
        }

        if (initRef.current) return;
        initRef.current = true;

        const CACHE_KEY = 'aciacam_user_profile';

        // Safety Timeout: Force loading false after 20s if still stuck
        const safetyTimer = setTimeout(() => {
            setLoading(prev => {
                if (prev) {
                    console.warn("AuthContext: Safety Timeout triggered.");
                    setAuthError("La conexión está tardando más de lo habitual. Verificando sesión...");
                    setInitialized(true);
                    return false;
                }
                return prev;
            });
        }, 20000);

        const handleUserSession = async (userId: string, session: any) => {
            // DEDUPLICATION: Prevent parallel fetches
            if (fetchLock.current === userId) {
                console.log(`[AuthDebug] handleUserSession ignored for ${userId} (Already in progress)`);
                return;
            }
            fetchLock.current = userId;

            console.log("AuthContext: Handling User Session for", userId);
            setAuthError(null);
            setIsUnlinked(false);

            try {
                // 1. Fetch Socio (With optimized Race in StoreService)
                console.time("fetchSocio");
                
                const fetchPromise = StoreService.getSocioByUserId(userId);
                const fetchTimeout = new Promise<null>((_, reject) =>
                    setTimeout(() => reject(new Error('Fetch Socio Timeout')), 30000)
                );

                const socio = await Promise.race([fetchPromise, fetchTimeout]) as Socio | null;
                console.timeEnd("fetchSocio");

                if (socio) {
                    console.log("AuthContext: Socio found linked:", socio.id);

                    // Override role if Admin in Metadata (Source of Truth)
                    const authRole = session?.user?.app_metadata?.role;
                    if (authRole === 'admin') {
                        socio.rol = 'admin';
                    }

                    currentUserIdRef.current = userId;
                    setUser(socio);

                    // UPDATE CACHE
                    try {
                        localStorage.setItem(CACHE_KEY, JSON.stringify(socio));
                    } catch (e) {}

                } else {
                    console.warn("AuthContext: User authenticated but NO socio linked.");
                    setIsUnlinked(true);
                    currentUserIdRef.current = null;
                    setUser(null);
                    localStorage.removeItem(CACHE_KEY);

                    // Redirect to pending approval if not on an auth/exempt page
                    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
                        router.replace('/pendiente-aprobacion');
                    }
                }
            } catch (fetchErr: any) {
                console.error("AuthContext: Fetch Socio Failed:", fetchErr);
                // If we have a user (from cache), don't show full error yet, just log it.
                if (!user) {
                    setAuthError(`Error cargando perfil: ${fetchErr.message}`);
                }
            } finally {
                fetchLock.current = null;
                setLoading(false);
                setInitialized(true);
                clearTimeout(safetyTimer);
            }
        };

        // 1. SETUP LISTENER
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
            console.log(`[AuthDebug] ${new Date().toISOString()} Auth Event: ${event}`);

            if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && currentSession?.user) {
                if (currentUserIdRef.current !== currentSession.user.id) {
                    // Only show loader if we don't have this user in cache already
                    const cached = localStorage.getItem(CACHE_KEY);
                    if (!cached || JSON.parse(cached).auth_user_id !== currentSession.user.id) {
                        setLoading(true);
                    }
                }
                setSession(currentSession);
                await handleUserSession(currentSession.user.id, currentSession);
            } else if (event === 'SIGNED_OUT') {
                // IMPORTANT: Sometimes Supabase fires SIGNED_OUT on network glitches
                // Double check if there's REALLY no session before nuking state
                const { data: { session: verifiedSession } } = await supabase.auth.getSession();
                
                if (!verifiedSession) {
                    console.log("[AuthDebug] SIGNED_OUT confirmed. Cleaning up.");
                    currentUserIdRef.current = null;
                    setUser(null);
                    setSession(null);
                    setIsUnlinked(false);
                    setLoading(false);
                    setInitialized(true);
                    localStorage.removeItem(CACHE_KEY);
                    
                    // Only redirect if we are NOT already on login or auth pages
                    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/') && window.location.pathname !== '/login') {
                        router.replace('/login');
                    }
                } else {
                    console.warn("[AuthDebug] SIGNED_OUT event ignored: Session still exists.");
                }
            }
        });

        // 2. INITIALIZE SESSION
        const initSession = async () => {
            if (!supabase) return;

            console.log(`[AuthDebug] ${new Date().toISOString()} Starting initSession`);
            
            try {
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) throw error;

                if (session?.user) {
                    console.log("[AuthDebug] Session found in initSession");
                    setSession(session);

                    // OPTIMIZATION: Try to load from Cache for instant feel
                    try {
                        const cached = localStorage.getItem(CACHE_KEY);
                        if (cached) {
                            const socio = JSON.parse(cached);
                            // Verify this cache belongs to the logged in user
                            if (socio.auth_user_id === session.user.id || socio.user_id === session.user.id) {
                                console.log("[AuthDebug] Using cached socio profile");
                                setUser(socio);
                                setLoading(false);
                                setInitialized(true); // Allow UI to proceed with cached data
                                // We still run handleUserSession in background to verify/refresh
                            }
                        }
                    } catch (cacheErr) {
                        console.warn("AuthContext: Cache read failed", cacheErr);
                    }

                    await handleUserSession(session.user.id, session);
                } else {
                    console.log("[AuthDebug] No active session found.");
                    setLoading(false);
                    setInitialized(true);
                    clearTimeout(safetyTimer);
                }

            } catch (e: any) {
                console.error("[AuthDebug] initSession Error:", e);
                
                if (e?.message?.includes('Refresh Token Not Found') || e?.message?.includes('Invalid Refresh Token')) {
                    if (supabase) await supabase.auth.signOut();
                    setUser(null);
                    localStorage.removeItem(CACHE_KEY);
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
                pathname === '/reset-password' ||
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
                try {
                    localStorage.setItem('aciacam_user_profile', JSON.stringify(socio));
                } catch (e) {}
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
