"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Socio } from '@/types';
import { AuthService } from '@/services/authService';
import { useRouter } from 'next/navigation';

interface AuthContextType {
    user: Socio | null;
    loading: boolean;
    login: (contact: string) => Promise<boolean>;
    verify: (contact: string, code: string) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<Socio | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        // Check local storage for persisted session
        const storedUser = localStorage.getItem('aciacam_user');
        if (storedUser) {
            try {
                setUser(JSON.parse(storedUser));
            } catch (e) {
                console.error("Failed to parse stored user", e);
                localStorage.removeItem('aciacam_user');
            }
        }
        setLoading(false);
    }, []);

    const login = async (contact: string) => {
        // In a real app we would store the contact pending verification
        const success = await AuthService.sendVerificationCode(contact);
        return success;
    };

    const verify = async (contact: string, code: string) => {
        const user = await AuthService.verifyCode(contact, code);
        if (user) {
            setUser(user);
            localStorage.setItem('aciacam_user', JSON.stringify(user));
            return true;
        }
        return false;
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem('aciacam_user');
        router.push('/login');
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, verify, logout }}>
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
