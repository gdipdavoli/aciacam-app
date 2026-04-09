'use client';

import PWAInstaller from '@/app/components/PWAInstaller';
import Link from 'next/link';

export default function RegisterSuccessPage() {
    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsl(var(--background))', padding: '1rem' }}>
            <div style={{ padding: '2.5rem', maxWidth: '450px', width: '100%', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', backgroundColor: 'hsl(var(--card))', textAlign: 'center' }}>
                <div style={{ marginBottom: '1.5rem', color: '#10b981' }}>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                </div>
                
                <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '1rem' }}>¡Cuenta Activada!</h1>
                <p style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '2rem', lineHeight: '1.5' }}>
                    Tu contraseña ha sido creada con éxito. Ahora puedes acceder a la plataforma desde cualquier dispositivo.
                </p>

                <div style={{ backgroundColor: 'hsl(var(--secondary))', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem' }}>📱 Acceso directo</h2>
                    <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                        Para una mejor experiencia, te recomendamos instalar la aplicación en tu celular.
                    </p>
                    <PWAInstaller />
                </div>

                <Link 
                    href="/portal"
                    style={{
                        display: 'block',
                        padding: '1rem',
                        backgroundColor: 'hsl(var(--primary))',
                        color: 'hsl(var(--primary-foreground))',
                        textDecoration: 'none',
                        borderRadius: '8px',
                        fontWeight: 600,
                        transition: 'opacity 0.2s'
                    }}
                >
                    Ingresar al Portal
                </Link>
            </div>
        </div>
    );
}
