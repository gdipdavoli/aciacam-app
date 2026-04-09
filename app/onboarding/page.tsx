"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import PWAInstaller from '@/app/components/PWAInstaller';

export default function OnboardingPage() {
    const router = useRouter();

    return (
        <div style={{ maxWidth: '800px', margin: '4rem auto', padding: '2rem', textAlign: 'center', backgroundColor: 'hsl(var(--card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👋</div>
            <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>¡Bienvenido a la Comunidad!</h1>
            <p style={{ fontSize: '1.1rem', color: 'hsl(var(--muted-foreground))', marginBottom: '2rem' }}>
                Tu cuenta ha sido activada correctamente. Ahora podés acceder a todas las funcionalidades.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
                <Card
                    title="Realizar Pedidos"
                    desc="Explorá nuestras variedades y reservá tus productos."
                    action={() => router.push('/variedades')}
                />
                <Card
                    title="Mi Perfil"
                    desc="Gestioná tus datos y documentación."
                    action={() => router.push('/cuenta')}
                />
            </div>

            <button
                onClick={() => router.push('/variedades')}
                style={{
                    padding: '1rem 3rem',
                    fontSize: '1.1rem',
                    backgroundColor: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    fontWeight: 700
                }}
            >
                Comenzar
            </button>

            <div style={{ marginTop: '3rem', borderTop: '1px solid hsl(var(--border))', paddingTop: '2rem' }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>📱 Llevá ACIACAM con vos</h3>
                <p style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '1.5rem' }}>
                    Instalá nuestra aplicación para acceder más rápido y recibir notificaciones.
                </p>
                <div style={{ maxWidth: '300px', margin: '0 auto' }}>
                    <PWAInstaller />
                </div>
            </div>
        </div>
    );
}

function Card({ title, desc, action }: any) {
    return (
        <div style={{ padding: '1.5rem', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', textAlign: 'left', cursor: 'pointer', transition: 'transform 0.1s' }} onClick={action}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem' }}>{title}</h3>
            <p style={{ fontSize: '0.9rem', color: 'hsl(var(--muted-foreground))' }}>{desc}</p>
        </div>
    );
}
